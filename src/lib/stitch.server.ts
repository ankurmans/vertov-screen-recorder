import { getContainer } from "@cloudflare/containers"
import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { SessionUser } from "@/lib/auth.server"
import type { Upload, Workspace } from "@/db/schema"
import type { Transcript, TranscriptCue, TranscriptWord } from "@/lib/transcript"
import type { Role } from "@/lib/plans"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import { memberCanSee } from "@/lib/agent.server"
import { mapToExport } from "@/lib/cuts"
import { exportSignature, processExport, streamToR2 } from "@/lib/export.server"
import { describe } from "@/lib/process.server"
import { newShareId } from "@/lib/recordings.server"
import { getTranscript, getUploadById } from "@/lib/uploads.server"
import { aiEnabled } from "@/lib/workspace.server"

export const MAX_STITCH_CLIPS = 10

/** Creates the combined video's row right away and queues the render. */
export async function startStitch(
  user: SessionUser,
  workspace: Workspace,
  role: Role,
  ids: Array<string>,
  title: string | null,
): Promise<{ id: string } | { error: string }> {
  if (ids.length < 2 || ids.length > MAX_STITCH_CLIPS) return { error: `Pick 2 to ${MAX_STITCH_CLIPS} videos.` }
  const sources: Array<Upload> = []
  for (const id of ids) {
    const upload = await getUploadById(id)
    if (!upload || !memberCanSee(upload, user, workspace.id, role) || upload.mediaType !== "video" || upload.status !== "ready") {
      return { error: "One of those videos isn't available to combine yet." }
    }
    sources.push(upload)
  }
  const id = newShareId()
  await db.insert(uploads).values({
    id,
    filename: "recording.mp4",
    contentType: "video/mp4",
    size: 0,
    r2Key: `uploads/${id}/recording.mp4`,
    mediaType: "video",
    ownerId: user.sub,
    workspaceId: workspace.id,
    visibility: workspace.defaultVisibility,
    downloadsEnabled: workspace.downloadsDefault,
    status: "rendering",
    captureSurface: "stitch",
    title: title?.trim().slice(0, 200) || `${sources[0].title || "Video"} + ${sources.length - 1} more`,
  })
  await env.PROCESS_QUEUE.send({ id, kind: "stitch", sources: ids })
  return { id }
}

/** The export that already matches the source's current edits, or a fresh one. */
async function exportKeyFor(source: Upload): Promise<string> {
  if (source.exportStatus === "done" && source.exportKey && source.exportSignature === exportSignature(source)) return source.exportKey
  await processExport(source.id)
  const fresh = await getUploadById(source.id)
  if (!fresh || fresh.exportStatus !== "done" || !fresh.exportKey) throw new Error(`couldn't render ${source.id}`)
  return fresh.exportKey
}

/** The clips' transcripts joined on the combined timeline. */
export async function mergeTranscripts(sources: Array<Upload>, durations: Array<number>): Promise<{ transcript: Transcript | null; offsets: Array<number> }> {
  const cues: Array<TranscriptCue> = []
  const words: Array<TranscriptWord> = []
  const offsets: Array<number> = []
  let offset = 0
  for (const [index, source] of sources.entries()) {
    offsets.push(offset)
    const transcript = await getTranscript(source)
    const span = durations[index] ?? 0
    for (const cue of transcript?.cues ?? []) {
      const start = mapToExport(source, cue.start)
      const end = mapToExport(source, cue.end)
      if (start == null || end == null || end <= start) continue
      cues.push({ start: offset + start, end: offset + Math.min(end, span), text: cue.text })
    }
    for (const word of transcript?.words ?? []) {
      const start = mapToExport(source, word.start)
      const end = mapToExport(source, word.end)
      if (start == null || end == null || end <= start) continue
      words.push({ text: word.text, start: offset + start, end: offset + Math.min(end, span) })
    }
    offset += span
  }
  return { transcript: cues.length ? { cues, words: words.length ? words : undefined } : null, offsets }
}

/** Queue job: render every clip with its edits, join them in the container, and fill in the rest. */
export async function processStitch(id: string, sourceIds: Array<string>): Promise<void> {
  const target = await getUploadById(id)
  if (!target || target.status !== "rendering") return
  try {
    const sources: Array<Upload> = []
    const keys: Array<string> = []
    for (const sourceId of sourceIds) {
      const source = await getUploadById(sourceId)
      if (!source) throw new Error(`missing source ${sourceId}`)
      keys.push(await exportKeyFor(source))
      sources.push((await getUploadById(sourceId)) ?? source)
    }
    const container = getContainer(env.EXPORTER, `${id}:${crypto.randomUUID()}`)
    const response = await container.fetch(
      new Request("http://exporter/concat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs: keys.map((key) => `http://media.internal/${key}`) }),
      }),
    )
    if (!response.ok || !response.body) throw new Error(`concat failed (${response.status}): ${(await response.text()).slice(0, 500)}`)
    const durations = (response.headers.get("x-durations") ?? "").split(",").map(Number).filter((value) => Number.isFinite(value))
    const [width, height] = (response.headers.get("x-size") ?? "").split("x").map(Number)
    const size = await streamToR2(target.r2Key, response.body)

    const { transcript, offsets } = await mergeTranscripts(sources, durations)
    const total = durations.reduce((sum, value) => sum + value, 0)
    const chapters = sources.map((source, index) => ({ title: (source.title || `Clip ${index + 1}`).slice(0, 80), start: Math.round(offsets[index] * 10) / 10 }))
    let transcriptKey: string | null = null
    let summary: string | null = null
    if (transcript) {
      transcriptKey = `uploads/${id}/transcript.json`
      await env.BUCKET.put(transcriptKey, JSON.stringify(transcript), { httpMetadata: { contentType: "application/json" } })
      const workspace = target.workspaceId ? await db.query.workspaces.findFirst({ where: (table, { eq: same }) => same(table.id, target.workspaceId!) }) : null
      if (aiEnabled(workspace ?? null)) summary = (await describe(transcript, total).catch(() => ({ summary: undefined }))).summary?.slice(0, 2000) ?? null
    }
    const poster = sources[0].posterKey ? await env.BUCKET.get(sources[0].posterKey) : null
    let posterKey: string | null = null
    if (poster) {
      posterKey = `uploads/${id}/poster`
      await env.BUCKET.put(posterKey, poster.body, { httpMetadata: { contentType: poster.httpMetadata?.contentType ?? "image/jpeg" } })
    }
    await db
      .update(uploads)
      .set({
        size,
        duration: total,
        width: width || null,
        height: height || null,
        status: "ready",
        transcriptKey,
        transcriptText: transcript ? transcript.cues.map((cue) => cue.text).join(" ").slice(0, 100_000) : null,
        language: sources.find((source) => source.language)?.language ?? null,
        summary,
        chapters: chapters.length > 1 ? JSON.stringify(chapters) : null,
        posterKey,
        aiStatus: "done",
      })
      .where(eq(uploads.id, id))
  } catch (error) {
    console.error(JSON.stringify({ message: "Stitch failed", id, error: error instanceof Error ? error.message : String(error) }))
    await db.update(uploads).set({ status: "failed" }).where(eq(uploads.id, id))
  }
}
