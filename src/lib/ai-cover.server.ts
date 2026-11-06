import { getContainer } from "@cloudflare/containers"
import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import type { Upload } from "@/db/schema"
import { posterKeyFor } from "@/lib/poster.server"

/**
 * AI covers: Workers AI's FLUX.2 [klein] 9B (owner-approved 2026-11-05; see docs/ai-policy.md) paints a thumbnail
 * scene from two references, the clearest frame of the video and the presenter's face (the camera track, else the
 * owner's profile photo), and the exporter sets the title and length on top so the words are always right. About
 * $0.015 per 1 MP image plus $0.002 per MP of references on Workers AI pricing. Made only when the owner asks, and
 * saved as their own thumbnail ("custom"), so automatic covers never replace it.
 */
export const AI_COVER_MODEL = "@cf/black-forest-labs/flux-2-klein-9b"

const SCENE_WITH_PERSON =
  "Professional YouTube tutorial thumbnail, photorealistic, cinematic studio lighting. On the right side: the person from image 1, chest up, same face, hair and clothing, a confident knowing half-smile with mouth closed, looking at the camera, soft key light from the left and a rim light on the hair. On the left and bottom: the software screen from image 0 shown as a large glossy floating card tilted slightly toward the viewer, crisp, with a soft shadow. Background: deep charcoal green #1d211b with a soft sage glow behind the person. Keep the top-left third of the frame clear and dark. No text, no letters, no logos, no watermark."
// Without a face reference the model invents a presenter (it did, a stranger), so this one says no people outright.
const SCENE_SCREEN_ONLY =
  "Premium product thumbnail, photorealistic, cinematic studio lighting. The software screen from image 0 shown as a large glossy floating card, tilted slightly toward the viewer, crisp, with a soft shadow and a subtle reflection, filling the right two-thirds of the frame. Background: deep charcoal green #1d211b with a soft sage glow. Keep the top-left third of the frame clear and dark. No people, no person, no face, no hands, no text, no letters, no logos, no watermark."

async function exporterImage(path: "poster" | "cover", job: Record<string, unknown>): Promise<ArrayBuffer> {
  const container = getContainer(env.EXPORTER, "poster")
  const response = await container.fetch(
    new Request(`http://exporter/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(job) }),
  )
  if (!response.ok) throw new Error(`exporter ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  return response.arrayBuffer()
}

/** The owner's profile photo: an uploaded one in R2, or the Google photo by URL. */
async function profilePhoto(ownerId: string | null): Promise<Blob | null> {
  if (!ownerId) return null
  const row = await env.DB.prepare('SELECT image FROM "user" WHERE id = ?').bind(ownerId).first<{ image: string | null }>()
  const image = row?.image
  if (!image) return null
  const uploaded = /^\/api\/avatar\/([\w-]+)\?v=([a-f0-9-]{8})$/.exec(image)
  if (uploaded) {
    const object = await env.BUCKET.get(`avatars/${uploaded[1]}-${uploaded[2]}`)
    return object ? new Blob([await object.arrayBuffer()], { type: object.httpMetadata?.contentType ?? "image/png" }) : null
  }
  if (!/^https:\/\//.test(image)) return null
  const response = await fetch(image).catch(() => null)
  return response?.ok ? new Blob([await response.arrayBuffer()], { type: response.headers.get("content-type") ?? "image/jpeg" }) : null
}

export async function makeAiCover(upload: Upload): Promise<string> {
  const duration = upload.duration ?? null
  const frame = new Blob([await exporterImage("poster", { video_url: `http://media.internal/${upload.r2Key}`, duration, width: 1024 })], { type: "image/jpeg" })
  const face = upload.cameraKey
    ? new Blob([await exporterImage("poster", { video_url: `http://media.internal/${upload.cameraKey}`, duration, width: 768 })], { type: "image/jpeg" })
    : await profilePhoto(upload.ownerId)

  const form = new FormData()
  form.append("prompt", face ? SCENE_WITH_PERSON : SCENE_SCREEN_ONLY)
  form.append("width", "1280")
  form.append("height", "720")
  form.append("input_image_0", frame, "frame.jpg")
  if (face) form.append("input_image_1", face, "face.jpg")
  const body = new Response(form)
  const result = (await env.AI.run(
    AI_COVER_MODEL as Parameters<typeof env.AI.run>[0],
    { multipart: { body: body.body, contentType: body.headers.get("content-type") ?? "multipart/form-data" } } as never,
    // Not through the AI gateway: it rejects the streamed multipart body this model takes.
  )) as { image?: string }
  if (!result?.image) throw new Error("the image model returned no image")
  console.log(JSON.stringify({ message: "AI cover generated", id: upload.id, model: AI_COVER_MODEL, face: Boolean(face) }))

  // The scene goes to R2 so the exporter (no internet) can read it, then the title and length go on top.
  const sceneKey = `uploads/${upload.id}/cover-scene`
  await env.BUCKET.put(sceneKey, Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0)), { httpMetadata: { contentType: "image/png" } })
  const cover = await exporterImage("cover", { background_url: `http://media.internal/${sceneKey}`, title: upload.title || "Untitled video", duration })
  const key = posterKeyFor(upload.id)
  await env.BUCKET.put(key, cover, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { source: "custom", style: "ai" } })
  await db.update(uploads).set({ posterKey: key }).where(eq(uploads.id, upload.id))
  return key
}
