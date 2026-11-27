import { getContainer } from "@cloudflare/containers"
import { inRegion } from "@/lib/region.server"
import { env } from "cloudflare:workers"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import type { Upload } from "@/db/schema"
import { allow } from "@/lib/rate-limit.server"
import { getUploadById } from "@/lib/uploads.server"
import { copyCovers, needsCopy, parseViewerCopy } from "@/lib/viewer-copy"
import type { ViewerCopy } from "@/lib/viewer-copy"
import { viewerCopiesMode } from "@/lib/viewer-copy-access.server"

/**
 * Every video gets a real thumbnail: the exporter picks the most detailed of a dozen frames (exporter/poster.py). Each
 * poster in R2 records where it came from, in its custom metadata:
 *   custom: the owner chose it (Customize → Use this frame); replaced only when they ask for a fresh pick
 *   import: Loom's own thumbnail; kept
 *   auto: made here; remade when the title or the workspace's look changes
 *   first-frame: the recorder's or file upload's instant first frame, which an automatic one replaces
 * Posters written before this existed carry no source and are left alone, since some are owners' choices.
 */
export type PosterSource = "custom" | "import" | "auto" | "first-frame"
/**
 * fill: only where there's nothing better. refresh: also remake automatic ones. force: the owner asked; anything but Loom's.
 * copy: footage was removed from the video, so any thumbnail but the owner's own choice may show it.
 */
export type PosterMode = "fill" | "refresh" | "force" | "copy"

export const posterKeyFor = (id: string) => `uploads/${id}/poster`

/**
 * Every thumbnail goes through one shared exporter instance, so how often one person, workspace or video can ask for
 * one is capped. `sourceBytes` is how much of the video the instance reads to pick a frame: the frames it samples from a
 * longer file come from that first part.
 */
export const POSTER_LIMITS = {
  perUserPerHour: 20,
  perWorkspacePerHour: 60,
  queuedPerVideoPerHour: 12,
  workspaceRefreshesPerHour: 6,
  sourceBytes: 1024 * 1024 * 1024,
} as const

/** The media URL the exporter reads a poster's frames from, capped at POSTER_LIMITS.sourceBytes (see media.internal in server.ts). */
export const posterSourceUrl = (key: string) => `http://media.internal/${key}?bytes=${POSTER_LIMITS.sourceBytes}`

/** Whether `userId` may ask for a fresh thumbnail of `upload` now (Customize → Pick one for me). */
export async function posterAdmission(upload: { workspaceId: string | null }, userId: string): Promise<boolean> {
  return (
    (await allow(`poster:u:${userId}`, POSTER_LIMITS.perUserPerHour, 3600)) &&
    (!upload.workspaceId || (await allow(`poster:w:${upload.workspaceId}`, POSTER_LIMITS.perWorkspacePerHour, 3600)))
  )
}

/** Queue a thumbnail shortly after an upload settles, so the recorder's first-frame poster has landed first. */
export async function queuePoster(id: string, delaySeconds = 20, mode: PosterMode = "fill"): Promise<void> {
  // A video that keeps asking (a title edited over and over) stops queueing for the rest of the hour.
  const admitted = await allow(`poster:v:${id}`, POSTER_LIMITS.queuedPerVideoPerHour, 3600).catch(() => true)
  if (!admitted) {
    console.warn(JSON.stringify({ message: "Poster not queued: hourly limit", id }))
    return
  }
  await env.PROCESS_QUEUE.send({ id, kind: "poster", mode }, { delaySeconds }).catch((error: unknown) =>
    console.warn(JSON.stringify({ message: "Poster not queued", id, error: String(error) })),
  )
}

/** The source of the poster stored for a video, or null when it has none. */
export async function posterSource(key: string | null): Promise<PosterSource | "unknown" | null> {
  if (!key) return null
  const head = await env.BUCKET.head(key)
  if (!head) return null
  return (head.customMetadata?.source as PosterSource | undefined) ?? "unknown"
}

const replaces = (source: PosterSource | "unknown" | null, mode: PosterMode) =>
  mode === "copy"
    ? source !== "custom"
    : source === null || source === "first-frame" || (mode !== "fill" && source === "auto") || (mode === "force" && source !== "import")

/** The files a thumbnail may be picked from: the copy's once anything is kept from viewers, none while that copy is missing. */
export function posterTracks(upload: Upload, copy?: ViewerCopy): { screen: string; camera: string | null } | null {
  if (viewerCopiesMode() === "off" || !needsCopy(upload)) return { screen: upload.r2Key, camera: upload.cameraKey }
  const made = copy ?? parseViewerCopy(upload.viewerCopy)
  return made && copyCovers(made, upload) ? { screen: made.screen.key, camera: made.camera?.key ?? null } : null
}

/** Queue job: make the video's thumbnail if the mode allows replacing what it has. */
export async function processPoster(id: string, mode: PosterMode = "fill", copy?: ViewerCopy): Promise<void> {
  const upload = await getUploadById(id)
  if (!upload || upload.status !== "ready" || upload.mediaType !== "video" || !upload.r2Key) return
  if (!replaces(await posterSource(upload.posterKey), mode)) return
  const tracks = posterTracks(upload, copy)
  if (!tracks) return
  const job = { video_url: posterSourceUrl(upload.r2Key), duration: upload.duration ?? null, width: 1280 }
  // One shared instance: these take a few seconds, and a fresh instance per video would use up the container limit
  // that exports need (max_instances in wrangler.jsonc).
  const container = getContainer(inRegion(env.EXPORTER), "poster")
  const response = await container.fetch(
    new Request("http://exporter/poster", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(job) }),
  )
  if (!response.ok || !response.body) {
    throw new Error(`poster frame failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  }
  const key = posterKeyFor(id)
  await env.BUCKET.put(key, await response.arrayBuffer(), {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { source: "auto", style: "frame" },
  })
  await db.update(uploads).set({ posterKey: key }).where(eq(uploads.id, id))
}

/** Daily: queue a thumbnail for ready videos that still have none (older uploads, or a pick that failed). */
export async function sweepPosters(limit = 200): Promise<{ queued: number }> {
  const missing = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(eq(uploads.status, "ready"), eq(uploads.mediaType, "video"), isNull(uploads.posterKey), isNull(uploads.deletedAt)))
    .limit(limit)
  for (const [index, row] of missing.entries()) await queuePoster(row.id, Math.min(600, index * 3))
  return { queued: missing.length }
}
