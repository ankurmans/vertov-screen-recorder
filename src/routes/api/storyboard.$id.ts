import { createFileRoute } from "@tanstack/react-router"
import { denyUnlessViewable } from "@/lib/access.server"
import { optionsResponse, withCors } from "@/lib/api.server"
import { serveAsset } from "@/lib/media-response.server"
import { getUploadById } from "@/lib/uploads.server"
import { limitedViewer, viewerPlayback } from "@/lib/viewer-copy-access.server"

/** The scrub-preview sprite sheet. */
export const Route = createFileRoute("/api/storyboard/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        // The sprite sheet shows moments from all of the original.
        if (upload && (await limitedViewer(upload, request))) return withCors(new Response("Not found", { status: 404 }))
        const edited = upload && viewerPlayback(upload).kind !== "original"
        return serveAsset(upload?.storyboardKey ?? null, "image/jpeg", edited ? "private, max-age=3600" : undefined)
      },
      OPTIONS: () => optionsResponse(),
    },
  },
})
