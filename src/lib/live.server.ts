import { env } from "cloudflare:workers"

const MAX_CHUNKS = 4000
const prefix = (id: string) => `uploads/${id}/live/`
export const chunkKey = (id: string, n: number) => `${prefix(id)}${String(n).padStart(6, "0")}`
export const manifestKey = (id: string) => `${prefix(id)}manifest.json`

/** How many live chunks have arrived, plus the media type they share. */
export async function liveState(id: string): Promise<{ count: number; mime: string | null }> {
  const manifest = await env.BUCKET.get(manifestKey(id))
  if (!manifest) return { count: 0, mime: null }
  const { mime } = (await manifest.json<{ mime?: string }>().catch(() => ({}))) as { mime?: string }
  let count = 0
  let cursor: string | undefined
  do {
    const page = await env.BUCKET.list({ prefix: prefix(id), cursor, limit: 1000 })
    count += page.objects.filter((object) => !object.key.endsWith("manifest.json")).length
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return { count, mime: mime ?? null }
}

export async function putChunk(id: string, n: number, body: ArrayBuffer, mime: string): Promise<boolean> {
  if (n < 1 || n > MAX_CHUNKS) return false
  if (n === 1) await env.BUCKET.put(manifestKey(id), JSON.stringify({ mime }))
  await env.BUCKET.put(chunkKey(id, n), body, { httpMetadata: { contentType: mime.split(";")[0] } })
  return true
}

/** The live copy exists only while recording; once the real video is ready it goes. */
export async function deleteLive(id: string): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await env.BUCKET.list({ prefix: prefix(id), cursor, limit: 1000 })
    if (page.objects.length) await env.BUCKET.delete(page.objects.map((object) => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}
