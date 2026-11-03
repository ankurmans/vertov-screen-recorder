import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { denyUnlessViewable } from "@/lib/access.server"
import { getUploadById } from "@/lib/uploads.server"

/** An image placed on a video. Viewable by whoever can watch that video. */
export const Route = createFileRoute("/api/overlay-image/$uploadId/$name")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!/^[a-f0-9]{16}\.(png|jpg|webp)$/.test(params.name)) return new Response("Not found", { status: 404 })
        const upload = await getUploadById(params.uploadId)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        const object = await env.BUCKET.get(`uploads/overlays/${params.uploadId}/${params.name}`)
        if (!object) return new Response("Not found", { status: 404 })
        return new Response(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "image/png",
            "cache-control": "private, max-age=86400",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
          },
        })
      },
    },
  },
})
