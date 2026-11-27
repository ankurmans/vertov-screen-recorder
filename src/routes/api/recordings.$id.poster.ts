import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { posterAdmission, processPoster } from "@/lib/poster.server"
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
          if (!(await posterAdmission(upload, user.sub))) {
            return json({ error: "Too many thumbnail picks this hour. Try again later." }, { status: 429, headers: { "retry-after": "600" } })
          }
          try {
            await processPoster(upload.id, "force")
          } catch (error) {
            // The thumbnail instance is shared; a busy or failed pick is reported as such, not as a server error.
            console.warn(JSON.stringify({ message: "Poster pick failed", id: upload.id, error: error instanceof Error ? error.message : String(error) }))
            return json({ error: "Thumbnails are busy right now. Try again in a minute." }, { status: 503, headers: { "retry-after": "60" } })
          }
          const updated = await getUploadById(upload.id)
          return json({ posterKey: updated?.posterKey ?? null })
        }),
    },
  },
})
