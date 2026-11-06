import { getContainer } from "@cloudflare/containers"
import { env } from "cloudflare:workers"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { uploads, workspaces } from "@/db/schema"
import { HOSTED_EDITION } from "@/lib/edition"
import { getUploadById } from "@/lib/uploads.server"

/**
 * Every video gets a real thumbnail. The exporter picks the most detailed of a dozen frames (exporter/poster.py), and
 * in the hosted edition, unless the workspace chose plain frames, turns it into a designed cover: title, length, the
 * frame as a screen card and the camera in a circle (exporter/cover.py). Each poster in R2 records where it came from,
 * in its custom metadata:
 *   custom: the owner chose it (Customize → Use this frame); replaced only when they ask for a fresh pick
 *   import: Loom's own thumbnail; kept
 *   auto: made here; remade when the title or the workspace's look changes
 *   first-frame: the recorder's or file upload's instant first frame, which an automatic one replaces
 * Posters written before this existed carry no source and are left alone, since some are owners' choices.
 */
export type PosterSource = "custom" | "import" | "auto" | "first-frame"
/** fill: only where there's nothing better. refresh: also remake automatic ones. force: the owner asked; anything but Loom's. */
export type PosterMode = "fill" | "refresh" | "force"

export const posterKeyFor = (id: string) => `uploads/${id}/poster`

/** Queue a thumbnail shortly after an upload settles, so the recorder's first-frame poster has landed first. */
export async function queuePoster(id: string, delaySeconds = 20, mode: PosterMode = "fill"): Promise<void> {
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
  source === null || source === "first-frame" || (mode !== "fill" && source === "auto") || (mode === "force" && source !== "import")

/** Queue job: make the video's thumbnail if the mode allows replacing what it has. */
export async function processPoster(id: string, mode: PosterMode = "fill"): Promise<void> {
  const upload = await getUploadById(id)
  if (!upload || upload.status !== "ready" || upload.mediaType !== "video" || !upload.r2Key) return
  if (!replaces(await posterSource(upload.posterKey), mode)) return
  const workspace = upload.workspaceId ? ((await db.query.workspaces.findFirst({ where: eq(workspaces.id, upload.workspaceId) })) ?? null) : null
  const designed = HOSTED_EDITION && (workspace?.coverStyle ?? "designed") === "designed"
  const job = {
    video_url: `http://media.internal/${upload.r2Key}`,
    duration: upload.duration ?? null,
    width: 1280,
    ...(designed
      ? {
          title: upload.title || "Untitled video",
          camera_url: upload.cameraKey ? `http://media.internal/${upload.cameraKey}` : null,
          brand_color: workspace?.brandColor ?? null,
        }
      : {}),
  }
  // One shared instance: these take a few seconds, and a fresh instance per video would use up the container limit
  // that exports need (max_instances in wrangler.jsonc).
  const container = getContainer(env.EXPORTER, "poster")
  const response = await container.fetch(
    new Request(`http://exporter/${designed ? "cover" : "poster"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(job) }),
  )
  if (!response.ok || !response.body) {
    throw new Error(`poster ${designed ? "cover" : "frame"} failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  }
  const key = posterKeyFor(id)
  await env.BUCKET.put(key, await response.arrayBuffer(), {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { source: "auto", style: designed ? "designed" : "frame" },
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

/** After the workspace's cover look changes: remake its automatic thumbnails, a few seconds apart. */
export async function refreshWorkspaceCovers(workspaceId: string, limit = 300): Promise<void> {
  const rows = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(eq(uploads.workspaceId, workspaceId), eq(uploads.status, "ready"), eq(uploads.mediaType, "video"), isNull(uploads.deletedAt)))
    .limit(limit)
  for (const [index, row] of rows.entries()) await queuePoster(row.id, Math.min(900, 2 + index * 3), "refresh")
}
