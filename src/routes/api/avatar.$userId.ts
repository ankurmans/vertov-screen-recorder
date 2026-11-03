import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"

/** A user's uploaded profile picture. Public like any avatar on a share page; the URL carries a version, so it caches for a year. */
export const Route = createFileRoute("/api/avatar/$userId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const version = new URL(request.url).searchParams.get("v")
        if (!version || !/^[a-f0-9-]{8}$/.test(version) || !/^[\w-]+$/.test(params.userId)) return new Response("Not found", { status: 404 })
        const object = await env.BUCKET.get(`avatars/${params.userId}-${version}`)
        if (!object) return new Response("Not found", { status: 404 })
        return new Response(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "image/png",
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
          },
        })
      },
    },
  },
})
