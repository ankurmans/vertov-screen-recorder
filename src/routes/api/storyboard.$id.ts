import { createFileRoute } from "@tanstack/react-router"
import { denyUnlessViewable } from "@/lib/access.server"
import { optionsResponse } from "@/lib/api.server"
import { serveAsset } from "@/lib/media-response.server"
import { getUploadById } from "@/lib/uploads.server"

/** The scrub-preview sprite sheet. */
export const Route = createFileRoute("/api/storyboard/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        return serveAsset(upload?.storyboardKey ?? null, "image/jpeg")
      },
      OPTIONS: () => optionsResponse(),
    },
  },
})
