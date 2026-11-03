import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { json } from "@/lib/api.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"

const MAX_IMAGE = 2 * 1024 * 1024
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

/** Owner upload (raw image body) of a picture to place on the video; returns the overlay's `src`. */
export const Route = createFileRoute("/api/recordings/$id/overlay-image")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Recording not found" }, 404)
          const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
          const extension = TYPES[type]
          if (!extension) return json({ error: "Use a PNG, JPEG or WebP image" }, 400)
          const bytes = await request.arrayBuffer()
          if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE) return json({ error: "Images must be under 2 MB" }, 400)
          const name = `${[...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}.${extension}`
          // Under uploads/ so the exporter container can read it for MP4 renders.
          await env.BUCKET.put(`uploads/overlays/${upload.id}/${name}`, bytes, { httpMetadata: { contentType: type } })
          return json({ src: `/api/overlay-image/${upload.id}/${name}` })
        }),
    },
  },
})
