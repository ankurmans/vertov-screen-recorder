import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { processPoster } from "@/lib/poster.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"
import { getUploadById } from "@/lib/uploads.server"

/** The owner asks for a fresh automatic thumbnail (Customize → Pick one for me). Replaces their own pick too. */
export const Route = createFileRoute("/api/recordings/$id/poster")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Recording not found" }, 404)
          if (upload.status !== "ready" || upload.mediaType !== "video") return json({ error: "Only a finished video has frames to pick from" }, 409)
          await processPoster(upload.id, "force")
          const updated = await getUploadById(upload.id)
          return json({ posterKey: updated?.posterKey ?? null })
        }),
    },
  },
})
