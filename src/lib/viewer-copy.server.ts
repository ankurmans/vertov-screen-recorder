/**
 * Renders the copy viewers get of an edited video (see viewer-copy.ts). Queue messages: "viewer-copy" a quiet minute after
 * an edit, then "viewer-copy-step" once per look at the exporter, one track at a time. Only the run named in viewer_run may
 * finish, so a later edit cancels it by clearing that column.
 */
import { env } from "cloudflare:workers"
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import type { Upload } from "@/db/schema"
import type { Cut } from "@/lib/cuts"
import { trackError } from "@/lib/error-report.server"
import {
  ContainerBusyError, destroyExportJob, exportJobName, exportJobOutput, exportJobState, pollSeconds, renderDeadlineMs, startExportJob, streamToR2,
} from "@/lib/export.server"
import { processPoster } from "@/lib/poster.server"
import { getUploadById } from "@/lib/uploads.server"
import { copyIsCurrent, needsCopy, parseViewerCopy, removedSpans, trackSources } from "@/lib/viewer-copy"
import type { Track, ViewerCopy } from "@/lib/viewer-copy"
import { viewerCopiesMode } from "@/lib/viewer-copy-access.server"
import { trackMasks } from "@/lib/viewer-masks"
import type { Masks } from "@/lib/viewer-masks"

/** The editor saves every change, so a render waits until the edits have been still this long. */
const QUIET_SECONDS = 60
/** A pending copy nothing has touched for this long has lost its message; the sweep asks again. */
const STUCK_MS = 30 * 60_000
const SWEEP_LIMIT = 3
const MAX_RESTARTS = 3

/** One render in progress; it travels in the queue message. `name` is null until the current track's job has started. */
export type CopyRun = {
  run: string
  token: string
  spans: Array<Cut>
  masks: Masks
  sources: Partial<Record<Track, string>>
  done: number
  name: string | null
  startedAt: number
  restarts: number
}

const sendCopy = (id: string, delaySeconds: number) => env.PROCESS_QUEUE.send({ id, kind: "viewer-copy" as const }, { delaySeconds })
const sendStep = (id: string, run: CopyRun, delaySeconds: number) => env.PROCESS_QUEUE.send({ id, kind: "viewer-copy-step" as const, run }, { delaySeconds })

/** Call after anything that changes what viewers may get: the trim, the cuts, or a track. */
export async function requestViewerCopy(id: string): Promise<void> {
  if (viewerCopiesMode() === "off") {
    // Forget the old verdict, so the sweep looks at this video again once copies are switched back on.
    await db.update(uploads).set({ viewerStatus: null, viewerRun: null }).where(and(eq(uploads.id, id), isNotNull(uploads.viewerStatus)))
    return
  }
  const upload = await getUploadById(id)
  if (!upload || upload.mediaType !== "video") return
  if (!needsCopy(upload)) {
    await db.update(uploads).set({ viewerStatus: null, viewerRun: null, viewerEditedAt: null }).where(eq(uploads.id, id))
    return
  }
  const copy = parseViewerCopy(upload.viewerCopy)
  if (copy && copyIsCurrent(copy, upload)) {
    await db.update(uploads).set({ viewerStatus: "done", viewerRun: null }).where(eq(uploads.id, id))
    return
  }
  await db.update(uploads).set({ viewerStatus: "pending", viewerRun: null, viewerEditedAt: Date.now() }).where(eq(uploads.id, id))
  // Delivery that fails is picked up by the sweep; the edit itself is already saved.
  await sendCopy(id, QUIET_SECONDS).catch((error: unknown) => trackError(error, { source: "job", route: "viewer-copy", uploadId: id }))
}

export async function processViewerCopy(id: string): Promise<void> {
  const upload = await getUploadById(id)
  if (!upload || upload.viewerStatus !== "pending" || upload.viewerRun || upload.deletedAt) return
  // A later edit sent its own message.
  if (!needsCopy(upload) || Date.now() - (upload.viewerEditedAt ?? 0) < (QUIET_SECONDS - 5) * 1000) return
  if (upload.status !== "ready") {
    await sendCopy(id, QUIET_SECONDS)
    return
  }
  const run: CopyRun = {
    run: crypto.randomUUID(), token: crypto.randomUUID().slice(0, 12), spans: removedSpans(upload), masks: trackMasks(upload), sources: trackSources(upload), done: 0, name: null, startedAt: Date.now(), restarts: 0,
  }
  const claimed = await db.update(uploads).set({ viewerRun: run.run, viewerEditedAt: Date.now() })
    .where(and(eq(uploads.id, id), eq(uploads.viewerStatus, "pending"), isNull(uploads.viewerRun)))
    .returning({ id: uploads.id })
  if (claimed.length) await sendStep(id, run, 0)
}

const tracksOf = (run: CopyRun) => (["screen", "camera"] as const).filter((track) => run.sources[track] !== undefined)
const keyFor = (id: string, token: string, track: Track) => `uploads/${id}/viewer/${token}/${track}.mp4`

function trackJob(upload: Upload, run: CopyRun, track: Track) {
  const url = (key: string) => `http://media.internal/${key}`
  if (track === "screen") return { url: url(upload.r2Key), spans: run.spans, width: upload.width, height: upload.height }
  return { url: url(upload.cameraKey!), spans: run.spans }
}

const ours = (id: string, run: CopyRun) => and(eq(uploads.id, id), eq(uploads.viewerStatus, "pending"), eq(uploads.viewerRun, run.run))

/** Removes what a dropped run made. A redelivered message must not take away the files that run has since published. */
async function discard(id: string, run: CopyRun): Promise<void> {
  if (parseViewerCopy((await getUploadById(id))?.viewerCopy)?.token !== run.token) {
    await env.BUCKET.delete(tracksOf(run).map((track) => keyFor(id, run.token, track)))
  }
  if (run.name) await destroyExportJob(run.name)
}

async function failCopy(id: string, run: CopyRun, error: unknown): Promise<void> {
  console.error(JSON.stringify({ message: "Viewer copy failed", id, error: error instanceof Error ? error.message : String(error) }))
  trackError(error, { source: "job", route: "viewer-copy", uploadId: id })
  await db.update(uploads).set({ viewerStatus: "failed", viewerRun: null }).where(ours(id, run))
  await discard(id, run)
}

/** One look at a running copy. Throws ContainerBusyError to have the queue deliver the step again later. */
export async function stepViewerCopy(id: string, run: CopyRun, attempts = 1): Promise<void> {
  const upload = await getUploadById(id)
  if (!upload || upload.status !== "ready" || upload.viewerStatus !== "pending" || upload.viewerRun !== run.run) return discard(id, run)
  const wanted = [removedSpans(upload), trackMasks(upload), trackSources(upload)]
  if (JSON.stringify(wanted) !== JSON.stringify([run.spans, run.masks, run.sources])) {
    await discard(id, run)
    return requestViewerCopy(id)
  }
  const track = tracksOf(run)[run.done]
  const heartbeat = () => db.update(uploads).set({ viewerEditedAt: Date.now() }).where(ours(id, run))
  try {
    if (!run.name) {
      const name = exportJobName(id)
      const job = trackJob(upload, run, track)
      await startExportJob(name, "blank", job)
      await heartbeat()
      const started = { ...run, name, startedAt: Date.now() }
      await sendStep(id, started, pollSeconds(started.startedAt))
      return
    }
    const status = await exportJobState(run.name)
    if (status.state === "running") {
      if (Date.now() - run.startedAt > renderDeadlineMs(upload.duration)) return await failCopy(id, run, new Error("the viewer copy took too long"))
      await heartbeat()
      await sendStep(id, run, pollSeconds(run.startedAt))
      return
    }
    if (status.state === "failed") return await failCopy(id, run, new Error(`viewer copy of the ${track} failed: ${(status.error ?? "").slice(0, 500)}`))
    if (status.state === "unknown") {
      // The instance restarted and the job went with it.
      if (run.restarts >= MAX_RESTARTS) return await failCopy(id, run, new Error("the viewer copy was interrupted too many times"))
      await destroyExportJob(run.name)
      await sendStep(id, { ...run, name: null, restarts: run.restarts + 1 }, 5)
      return
    }
    const output = await exportJobOutput(run.name)
    await streamToR2(keyFor(id, run.token, track), output.body!, "video/mp4")
    if (run.done + 1 < tracksOf(run).length) await sendStep(id, { ...run, done: run.done + 1, name: null }, 0)
    else await finishCopy(id, run)
    await destroyExportJob(run.name)
  } catch (error) {
    if (error instanceof ContainerBusyError) throw error
    // An exporter still running the previous image does not know this job yet.
    if (error instanceof Error && error.message.includes("unknown kind")) throw new ContainerBusyError("the exporter is still updating")
    if (attempts < 5) throw new ContainerBusyError(`viewer copy step will be retried: ${error instanceof Error ? error.message : String(error)}`)
    await failCopy(id, run, error)
  }
}

async function finishCopy(id: string, run: CopyRun): Promise<void> {
  const upload = await getUploadById(id)
  if (!upload) return
  const file = (track: Track) => ({ key: keyFor(id, run.token, track), from: run.sources[track]! })
  const copy: ViewerCopy = {
    token: run.token,
    spans: run.spans,
    ...(Object.keys(run.masks).length ? { masks: run.masks } : {}),
    screen: file("screen"),
    ...(run.sources.camera !== undefined ? { camera: file("camera") } : {}),
  }
  // The thumbnail is remade before viewers are let back in; one that cannot be is dropped rather than left showing removed footage.
  try {
    await processPoster(id, "copy", copy)
  } catch (error) {
    trackError(error, { source: "job", route: "viewer-copy", uploadId: id })
    await db.update(uploads).set({ posterKey: null }).where(ours(id, run))
  }
  const stored = await db.update(uploads).set({ viewerCopy: JSON.stringify(copy), viewerStatus: "done", viewerRun: null })
    .where(ours(id, run)).returning({ id: uploads.id })
  if (!stored.length) return discard(id, { ...run, name: null })
  const previous = parseViewerCopy(upload.viewerCopy)
  if (previous && previous.token !== run.token) {
    await env.BUCKET.delete([previous.screen, previous.camera].flatMap((old) => (old ? [old.key] : []))).catch(() => {})
  }
}

/**
 * Every ten minutes: ask again for copies whose message was lost, and make them, a few at a time, for videos edited before
 * copies existed or while they were switched off.
 */
export async function sweepViewerCopies(limit = SWEEP_LIMIT): Promise<{ queued: number }> {
  if (viewerCopiesMode() === "off") return { queued: 0 }
  const edited = or(isNotNull(uploads.cuts), sql`${uploads.trimStart} > 0`, isNotNull(uploads.trimEnd), isNotNull(uploads.overlays))
  const rows = await db.select().from(uploads).where(and(
    eq(uploads.status, "ready"), eq(uploads.mediaType, "video"), isNull(uploads.deletedAt),
    or(
      and(isNull(uploads.viewerStatus), edited),
      and(eq(uploads.viewerStatus, "pending"), lt(uploads.viewerEditedAt, Date.now() - STUCK_MS)),
    ),
  )).limit(limit)
  for (const upload of rows) {
    const copy = parseViewerCopy(upload.viewerCopy)
    // "[]" in cuts, or only annotations: nothing is kept from viewers, so mark it settled and don't look again.
    if (!needsCopy(upload) || (copy && copyIsCurrent(copy, upload))) {
      await db.update(uploads).set({ viewerStatus: "done", viewerRun: null }).where(eq(uploads.id, upload.id))
    } else {
      // A thumbnail from before copies existed may show removed footage; the owner's browser makes a new one.
      if (!upload.viewerStatus) await db.update(uploads).set({ gifKey: null }).where(eq(uploads.id, upload.id))
      await requestViewerCopy(upload.id)
    }
  }
  return { queued: rows.length }
}
