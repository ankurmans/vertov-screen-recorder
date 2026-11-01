import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { aiAllowed, generateAiDoc, isAiDocKind, parseAiDocs } from "@/lib/ai-docs.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"

const bodySchema = z.object({ kind: z.string() })

/** Written documents made from a video's transcript, for the owner or a workspace manager. */
export const Route = createFileRoute("/api/ai/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Not found" }, 404)
          return json({
            enabled: await aiAllowed(upload),
            hasTranscript: Boolean(upload.transcriptKey),
            docs: parseAiDocs(upload.aiDocs),
          })
        }),
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Not found" }, 404)
          const parsed = bodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success || !isAiDocKind(parsed.data.kind)) return json({ error: "Unknown document type" }, 400)
          if (!(await aiAllowed(upload))) return json({ error: "AI documents are part of the paid plans.", code: "ai_paid" }, 402)
          const doc = await generateAiDoc(upload, parsed.data.kind)
          if (!doc) return json({ error: "There's no transcript to write from yet." }, 409)
          return json({ kind: parsed.data.kind, ...doc })
        }),
    },
  },
})
