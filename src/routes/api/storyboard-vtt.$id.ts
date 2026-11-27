import { createFileRoute } from "@tanstack/react-router"
import { denyUnlessViewable } from "@/lib/access.server"
import { optionsResponse, withCors } from "@/lib/api.server"
import { parseStoryboardMeta, storyboardToVtt } from "@/lib/storyboard"
import { getUploadById } from "@/lib/uploads.server"
import { limitedViewer, viewerPlayback } from "@/lib/viewer-copy-access.server"

/**
 * Thumbnails WebVTT for the player's scrub preview, generated from the
 * stored grid metadata so the sprite URL always matches this origin.
 */
export const Route = createFileRoute("/api/storyboard-vtt/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        if (upload && (await limitedViewer(upload, request))) return withCors(new Response("Not found", { status: 404 }))
        if (!upload?.storyboardKey || !upload.storyboardMeta) {
          return withCors(new Response("Not found", { status: 404 }))
        }

        let meta = null
        try {
          meta = parseStoryboardMeta(JSON.parse(upload.storyboardMeta))
        } catch {
          meta = null
        }
        if (!meta) {
          return withCors(new Response("Not found", { status: 404 }))
        }

        const origin = new URL(request.url).origin
        const spriteUrl = `${origin}/api/storyboard/${upload.id}`
        return withCors(
          new Response(storyboardToVtt(meta, spriteUrl, upload.duration), {
            headers: {
              "content-type": "text/vtt; charset=utf-8",
              "cache-control": viewerPlayback(upload).kind === "original" ? "public, max-age=31536000, immutable" : "private, max-age=3600",
            },
          }),
        )
      },
      OPTIONS: () => optionsResponse(),
    },
  },
})
