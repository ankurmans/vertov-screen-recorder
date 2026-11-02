import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"
import { recordedZoomClicks } from "@/lib/zooms.server"

export const Route = createFileRoute("/api/zooms/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => userApi(request, async (user) => {
        const upload = await ownedUpload(params.id, user)
        if (!upload) return json({ error: "Recording not found" }, 404)
        return json({ clicks: await recordedZoomClicks(upload) }, { headers: { "cache-control": "private, no-store" } })
      }),
    },
  },
})
