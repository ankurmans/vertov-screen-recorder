import { createFileRoute } from "@tanstack/react-router"
import { denyUnlessViewable } from "@/lib/access.server"
import { optionsResponse, withCors } from "@/lib/api.server"
import { serveAsset } from "@/lib/media-response.server"
import { getUploadById } from "@/lib/uploads.server"
import { managesVideo, viewerPlayback } from "@/lib/viewer-copy-access.server"

export const Route = createFileRoute("/api/poster/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        // Until there is a copy without the removed footage, the thumbnail may still show it.
        if (upload && viewerPlayback(upload).kind === "held" && !(await managesVideo(upload, request))) return withCors(new Response("Not found", { status: 404 }))
        // Short cache: the recorder replaces the poster mid-recording, and owners can pick a new frame.
        return serveAsset(upload?.posterKey ?? null, "image/jpeg", "public, max-age=60")
      },
      OPTIONS: () => optionsResponse(),
    },
  },
})
