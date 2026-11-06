import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import { json } from "@/lib/api.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"
import { VoiceoverError, generateVoiceover, removeVoiceover } from "@/lib/voiceover.server"
import { getUploadById } from "@/lib/uploads.server"

const generateSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  voiceId: z.string().trim().min(1).max(64),
  voiceName: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(64).nullable().optional(),
})
const offsetSchema = z.object({ offset: z.number().min(0).max(36000) })

const state = (upload: NonNullable<Awaited<ReturnType<typeof getUploadById>>>) => ({
  has: Boolean(upload.voiceKey),
  key: upload.voiceKey,
  text: upload.voiceText,
  voiceId: upload.voiceVoiceId,
  voiceName: upload.voiceVoiceName,
  modelId: upload.voiceModel,
  offset: upload.voiceOffset,
})

/** A video's narration: read it, generate or replace it from a script, move where it starts, remove it. */
export const Route = createFileRoute("/api/recordings/$id/voiceover")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          return upload ? json(state(upload)) : json({ error: "Recording not found" }, 404)
        }),
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Recording not found" }, 404)
          if (upload.status !== "ready" || upload.mediaType !== "video") return json({ error: "Only a finished video can have a voiceover" }, 409)
          const parsed = generateSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Write the script and pick a voice." }, 400)
          try {
            const updated = await generateVoiceover(upload, { ...parsed.data, modelId: parsed.data.modelId ?? null }, user.sub)
            return json(state(updated))
          } catch (error) {
            if (error instanceof VoiceoverError) return json({ error: error.message }, error.status)
            throw error
          }
        }),
      PATCH: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Recording not found" }, 404)
          const parsed = offsetSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success || !upload.voiceKey) return json({ error: "Nothing to move" }, 400)
          await db.update(uploads).set({ voiceOffset: parsed.data.offset }).where(eq(uploads.id, upload.id))
          return json({ ...state(upload), offset: parsed.data.offset })
        }),
      DELETE: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user)
          if (!upload) return json({ error: "Recording not found" }, 404)
          await removeVoiceover(upload)
          return json({ has: false })
        }),
    },
  },
})
