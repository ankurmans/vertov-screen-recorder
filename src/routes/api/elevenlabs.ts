import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { workspaceApi } from "@/lib/workspace-api.server"
import { VoiceoverError, clearKey, defaultModel, grantStarterCredits, listModels, saveKey, sourceVoices, voiceCredits, voiceSource } from "@/lib/voiceover.server"
import { canManage } from "@/lib/plans"

const keySchema = z.object({ key: z.string().trim().min(20).max(200) })

const failure = (error: unknown) => {
  if (error instanceof VoiceoverError) return json({ error: error.message }, error.status)
  throw error
}

/**
 * The workspace's own ElevenLabs connection (voiceover is bring-your-own-key).
 * GET: connected or not, and when connected the account's voices and text-to-speech models. PUT: validate and keep a key. DELETE: forget it.
 */
export const Route = createFileRoute("/api/elevenlabs")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const source = await voiceSource(workspace.id)
          if (!source) return json({ connected: false, managed: false, canManage: canManage(role) })
          try {
            const [voices, models] = await Promise.all([sourceVoices(source), listModels(source.key)])
            // On Vertov voices the model is Vertov's choice and the provider isn't named, so only voices and the balance go out.
            if (source.managed) {
              await grantStarterCredits(workspace.id, user.sub)
              return json({ connected: false, managed: true, credits: await voiceCredits(workspace.id), canManage: canManage(role), voices })
            }
            return json({ connected: true, managed: false, canManage: canManage(role), voices, models, defaultModel: defaultModel(models)?.id ?? null })
          } catch (error) {
            if (source.managed && error instanceof VoiceoverError) return json({ error: "Voiceover is unavailable right now." }, 503)
            return failure(error)
          }
        }),
      PUT: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const parsed = keySchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Paste the whole key." }, 400)
            try {
              await saveKey(workspace.id, parsed.data.key)
            } catch (error) {
              return failure(error)
            }
            await audit(workspace.id, user.sub, "elevenlabs.connected", "")
            return json({ connected: true })
          },
          { manage: true },
        ),
      DELETE: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            await clearKey(workspace.id)
            await audit(workspace.id, user.sub, "elevenlabs.disconnected", "")
            return json({ connected: false })
          },
          { manage: true },
        ),
    },
  },
})
