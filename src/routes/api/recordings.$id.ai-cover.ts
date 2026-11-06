import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { makeAiCover } from "@/lib/ai-cover.server"
import { HOSTED_EDITION } from "@/lib/edition"
import { allow } from "@/lib/rate-limit.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"

/** The owner asks for an AI cover (Customize → Make an AI cover). Paid per image, so it's on request and rate-limited. */
export const Route = createFileRoute("/api/recordings/$id/ai-cover")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          if (!HOSTED_EDITION) return json({ error: "Not available" }, 404)
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Recording not found" }, 404)
          if (upload.status !== "ready" || upload.mediaType !== "video") return json({ error: "Only a finished video can have a cover made" }, 409)
          if (!(await allow(`ai-cover:${user.sub}`, 20, 3600))) return json({ error: "That's a lot of covers this hour. Try again later." }, 429)
          const posterKey = await makeAiCover(upload)
          return json({ posterKey })
        }),
    },
  },
})
