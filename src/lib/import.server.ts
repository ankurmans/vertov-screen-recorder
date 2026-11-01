import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { Workspace } from "@/db/schema"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import { streamToR2 } from "@/lib/export.server"
import { newShareId } from "@/lib/recordings.server"
import { getUploadById } from "@/lib/uploads.server"

const LOOM = "https://www.loom.com"
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; Vertov importer)" }
// Whisper takes the file inline, so only modest imports get a transcript.
const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024

export function loomIdFrom(url: string): string | null {
  return /loom\.com\/(?:share|embed)\/([a-f0-9]{32})/i.exec(url)?.[1]?.toLowerCase() ?? null
}

interface LoomOembed {
  title?: string
  width?: number
  height?: number
  duration?: number
  thumbnail_url?: string
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

/** Creates the library entry right away (so the link exists) and queues the copy. */
export async function startLoomImport(
  ownerId: string,
  workspace: Workspace,
  loomId: string,
): Promise<{ id: string; title: string | null }> {
  const response = await fetch(`${LOOM}/v1/oembed?url=${encodeURIComponent(`${LOOM}/share/${loomId}`)}`, { headers: HEADERS })
  if (!response.ok) throw new Error("That Loom isn't public, or the link is wrong")
  const meta: LoomOembed = await response.json()
  const id = newShareId()
  const title = meta.title ? decodeEntities(meta.title).slice(0, 200) : null
  await db.insert(uploads).values({
    id,
    filename: "recording.mp4",
    contentType: "video/mp4",
    size: 0,
    width: meta.width ?? null,
    height: meta.height ?? null,
    duration: meta.duration ?? null,
    title,
    r2Key: `uploads/${id}/recording.mp4`,
    mediaType: "video",
    ownerId,
    workspaceId: workspace.id,
    visibility: workspace.defaultVisibility,
    sourceUrl: `${LOOM}/share/${loomId}`,
    status: "importing",
    captureSurface: "import",
  })
  await env.PROCESS_QUEUE.send({ id, kind: "import", loomId })
  return { id, title }
}

/** Queue job: copy the Loom's MP4 and thumbnail into R2, then transcribe it. */
export async function processImport(id: string, loomId: string): Promise<void> {
  const upload = await getUploadById(id)
  if (!upload || upload.status !== "importing") return
  try {
    const source = await fetch(`${LOOM}/api/campaigns/sessions/${loomId}/transcoded-url`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
    })
    const { url } = (await source.json().catch(() => ({}))) as { url?: string }
    if (!source.ok || !url) throw new Error(`Loom wouldn't hand over the video (${source.status})`)
    const video = await fetch(url, { headers: HEADERS })
    if (!video.ok || !video.body) throw new Error(`Loom download failed (${video.status})`)
    const size = await streamToR2(upload.r2Key, video.body)

    let posterKey: string | null = null
    const oembed = await fetch(`${LOOM}/v1/oembed?url=${encodeURIComponent(`${LOOM}/share/${loomId}`)}`, { headers: HEADERS })
    const meta: LoomOembed = oembed.ok ? await oembed.json() : {}
    const thumbnail = meta.thumbnail_url
    if (thumbnail) {
      const image = await fetch(thumbnail, { headers: HEADERS })
      if (image.ok) {
        posterKey = `uploads/${id}/poster`
        await env.BUCKET.put(posterKey, image.body, {
          httpMetadata: { contentType: image.headers.get("content-type") ?? "image/gif" },
        })
      }
    }

    const transcribe = size <= MAX_TRANSCRIBE_BYTES
    await db
      .update(uploads)
      .set({
        size,
        posterKey,
        status: "ready",
        audioKey: transcribe ? upload.r2Key : null,
        aiStatus: transcribe ? "pending" : null,
      })
      .where(eq(uploads.id, id))
    if (transcribe) await env.PROCESS_QUEUE.send({ id })
  } catch (error) {
    console.error(JSON.stringify({ message: "Import failed", id, error: error instanceof Error ? error.message : String(error) }))
    await db.update(uploads).set({ status: "failed" }).where(eq(uploads.id, id))
  }
}
