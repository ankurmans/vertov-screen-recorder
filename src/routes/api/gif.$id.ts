import { createFileRoute } from "@tanstack/react-router"
import { denyUnlessViewable } from "@/lib/access.server"
import { optionsResponse } from "@/lib/api.server"
import { serveAsset } from "@/lib/media-response.server"
import { getUploadById } from "@/lib/uploads.server"

/** The animated GIF thumbnail, for emails and link previews. */
export const Route = createFileRoute("/api/gif/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        // The GIF is made when the owner first opens the finished video; until then the still poster stands in so a fresh email never shows a broken image.
        if (upload?.gifKey) return serveAsset(upload.gifKey, "image/gif", "public, max-age=300")
        return serveAsset(upload?.posterKey ?? null, "image/jpeg", "public, max-age=60")
      },
      OPTIONS: () => optionsResponse(),
    },
  },
})
