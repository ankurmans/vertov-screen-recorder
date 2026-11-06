import { Buffer } from "node:buffer"
import { and, eq, gte, sql } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { Upload } from "@/db/schema"
import { db } from "@/db"
import { uploads, voiceCreditLedger, workspaces } from "@/db/schema"
import { isUnclaimedGuest } from "@/lib/access.server"
import { seal, unseal } from "@/lib/secret-box.server"

/** Overridable only so tests can point at a stand-in server; production never sets it. */
const elevenBase = () => (env as unknown as Record<string, string | undefined>).ELEVENLABS_BASE_URL || "https://api.elevenlabs.io"

/** Characters per narration; also bounded by the model's own limit when the account reports one. */
export const MAX_VOICEOVER_CHARACTERS = 5000

export class VoiceoverError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export interface ElevenVoice {
  id: string
  name: string
  category: string | null
  previewUrl: string | null
}

export interface ElevenModel {
  id: string
  name: string
  maxCharacters: number | null
}

interface RawModel {
  model_id: string
  name?: string
  can_do_text_to_speech?: boolean
  maximum_text_length_per_request?: number
}

async function eleven(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${elevenBase()}${path}`, { ...init, headers: { "xi-api-key": key, ...(init.headers as Record<string, string> | undefined) } })
  if (response.ok) return response
  const detail = (await response.text().catch(() => "")).slice(0, 300)
  if (response.status === 401) {
    const missing = /missing_permissions|permission/i.test(detail)
    throw new VoiceoverError(missing ? "That ElevenLabs key is missing a permission. Give it text to speech, voices read and models read." : "ElevenLabs didn't accept that key.", 400)
  }
  if (response.status === 402 || /quota/i.test(detail)) throw new VoiceoverError("Your ElevenLabs account is out of credits.", 402)
  if (response.status === 429) throw new VoiceoverError("ElevenLabs is busy. Try again in a minute.", 429)
  console.error(JSON.stringify({ message: "ElevenLabs request failed", path: path.split("?")[0], status: response.status }))
  throw new VoiceoverError(`ElevenLabs couldn't do that (${response.status}).`, 502)
}

const envVar = (name: string) => (env as unknown as Record<string, string | undefined>)[name]

/** Vertov voices: narration through Vertov's own ElevenLabs account, metered in credits. Off unless both the key and VOICE_CREDITS=1 are set. */
export const managedVoices = () => Boolean(envVar("ELEVENLABS_API_KEY")) && envVar("VOICE_CREDITS") === "1"
const operatorKey = () => envVar("ELEVENLABS_API_KEY") ?? ""

/** Credits every workspace gets once, on its first look at Vertov voices, to hear what narration does for its video. Owner decision 2026-11-05. */
export const STARTER_CREDITS = 1500

/**
 * Gives the one-time starter credits to a workspace whose person has a real sign-in (not an unclaimed guest, so guest accounts can't farm them).
 * The ledger row's id is fixed per workspace, so two requests at once, or a second visit, can't grant it twice.
 */
export async function grantStarterCredits(workspaceId: string, userId: string): Promise<void> {
  if (!managedVoices() || (await isUnclaimedGuest(userId))) return
  const granted = await db
    .insert(voiceCreditLedger)
    .values({ id: `starter-${workspaceId}`, workspaceId, delta: STARTER_CREDITS, reason: "starter credits", uploadId: null, createdAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: voiceCreditLedger.id })
  if (granted.length) await db.update(workspaces).set({ voiceCredits: sql`${workspaces.voiceCredits} + ${STARTER_CREDITS}` }).where(eq(workspaces.id, workspaceId))
}

export async function voiceCredits(workspaceId: string): Promise<number> {
  const row = await db.select({ credits: workspaces.voiceCredits }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  return row?.credits ?? 0
}

/** Adds (or, negative, removes) credits and records why. */
export async function adjustVoiceCredits(workspaceId: string, delta: number, reason: string, uploadId: string | null = null): Promise<void> {
  await db.update(workspaces).set({ voiceCredits: sql`${workspaces.voiceCredits} + ${delta}` }).where(eq(workspaces.id, workspaceId))
  await db.insert(voiceCreditLedger).values({ id: crypto.randomUUID(), workspaceId, delta, reason, uploadId, createdAt: new Date() })
}

/** Takes the credits only if the balance covers them, in one statement, so two takes can't both spend the last ones. */
async function spendVoiceCredits(workspaceId: string, amount: number, uploadId: string): Promise<boolean> {
  const taken = await db
    .update(workspaces)
    .set({ voiceCredits: sql`${workspaces.voiceCredits} - ${amount}` })
    .where(and(eq(workspaces.id, workspaceId), gte(workspaces.voiceCredits, amount)))
    .returning({ id: workspaces.id })
  if (!taken.length) return false
  await db.insert(voiceCreditLedger).values({ id: crypto.randomUUID(), workspaceId, delta: -amount, reason: "narration", uploadId, createdAt: new Date() })
  return true
}

export async function workspaceKey(workspaceId: string): Promise<string | null> {
  const row = await db.select({ key: workspaces.elevenKey }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  return row?.key ? unseal(row.key) : null
}

/** Checks the key against the models list before keeping it, so a typo is caught now. */
export async function saveKey(workspaceId: string, key: string): Promise<void> {
  await listModels(key)
  await db.update(workspaces).set({ elevenKey: await seal(key.trim()) }).where(eq(workspaces.id, workspaceId))
}

export async function clearKey(workspaceId: string): Promise<void> {
  await db.update(workspaces).set({ elevenKey: null }).where(eq(workspaces.id, workspaceId))
}

export async function listModels(key: string): Promise<Array<ElevenModel>> {
  const models = (await (await eleven(key, "/v1/models")).json()) as Array<RawModel>
  return models
    .filter((model) => model.can_do_text_to_speech)
    .map((model) => ({ id: model.model_id, name: model.name ?? model.model_id, maxCharacters: model.maximum_text_length_per_request ?? null }))
}

export async function listVoices(key: string): Promise<Array<ElevenVoice>> {
  const { voices } = (await (await eleven(key, "/v2/voices?page_size=100")).json()) as {
    voices: Array<{ voice_id: string; name: string; category?: string; preview_url?: string }>
  }
  return voices.map((voice) => ({ id: voice.voice_id, name: voice.name, category: voice.category ?? null, previewUrl: voice.preview_url ?? null }))
}

/**
 * The voices a workspace may speak with. On Vertov voices only ElevenLabs' stock voices: the operator account also holds
 * cloned and library voices (people's own voices among them) that no customer may see or use.
 */
export async function sourceVoices(source: { key: string; managed: boolean }): Promise<Array<ElevenVoice>> {
  const voices = await listVoices(source.key)
  return source.managed ? voices.filter((voice) => voice.category === "premade") : voices
}

/** The model to use when the person doesn't pick one: Eleven v4 if the account has it, else the first text-to-speech model. */
export function defaultModel(models: Array<ElevenModel>): ElevenModel | null {
  return models.find((model) => /v4/i.test(model.id) || /\bv4\b/i.test(model.name)) ?? models[0] ?? null
}

/** Which key speaks for a workspace: its own (free to it) or Vertov's (credits). */
export async function voiceSource(workspaceId: string | null): Promise<{ key: string; managed: boolean } | null> {
  const own = workspaceId ? await workspaceKey(workspaceId) : null
  if (own) return { key: own, managed: false }
  return managedVoices() ? { key: operatorKey(), managed: true } : null
}

/** Speaks the script in the chosen voice and keeps the audio as the video's narration track. */
export async function generateVoiceover(
  upload: Upload,
  input: { text: string; voiceId: string; voiceName: string; modelId: string | null },
  userId: string,
): Promise<Upload> {
  const source = await voiceSource(upload.workspaceId)
  if (!source) throw new VoiceoverError("Connect your ElevenLabs key in Settings first.", 409)
  const { key, managed } = source
  const models = await listModels(key).catch((error) => {
    if (!managed || !(error instanceof VoiceoverError)) throw error
    console.error(JSON.stringify({ message: "Vertov voices provider error", detail: error.message }))
    throw new VoiceoverError("Voiceover is unavailable right now.", 503)
  })
  // Vertov voices pick the model themselves; people on the metered path never choose or see one.
  const model = !managed && input.modelId ? models.find((candidate) => candidate.id === input.modelId) : defaultModel(models)
  if (!model) throw new VoiceoverError(input.modelId && !managed ? "That model isn't available for text to speech on your ElevenLabs account." : "Your ElevenLabs account has no text-to-speech model.", 400)
  const limit = Math.min(MAX_VOICEOVER_CHARACTERS, model.maxCharacters ?? MAX_VOICEOVER_CHARACTERS)
  if (input.text.length > limit) throw new VoiceoverError(`That script is ${input.text.length.toLocaleString()} characters; this model takes up to ${limit.toLocaleString()} at a time.`, 413)
  if (managed && !(await sourceVoices(source)).some((voice) => voice.id === input.voiceId)) throw new VoiceoverError("Pick one of the listed voices.", 400)

  // Credits are taken first and given back if the voice service fails, so a failed take costs nothing.
  const cost = input.text.length
  if (managed) {
    if (upload.workspaceId) await grantStarterCredits(upload.workspaceId, userId)
    if (!upload.workspaceId || !(await spendVoiceCredits(upload.workspaceId, cost, upload.id))) {
      throw new VoiceoverError("You don't have enough voice credits for that script.", 402)
    }
  }
  let audio: ArrayBuffer
  try {
    const speech = await eleven(key, `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: input.text, model_id: model.id }),
    })
    audio = await speech.arrayBuffer()
    if (audio.byteLength < 1000) throw new VoiceoverError("The voice service sent back no audio.", 502)
  } catch (error) {
    if (managed && upload.workspaceId) await adjustVoiceCredits(upload.workspaceId, cost, "refund", upload.id)
    // An operator-side failure (bad key, our own ElevenLabs quota) is ours, not the customer's; keep the wording neutral.
    if (managed && error instanceof VoiceoverError) {
      console.error(JSON.stringify({ message: "Vertov voices provider error", detail: error.message }))
      throw new VoiceoverError("Voiceover is unavailable right now. You weren't charged.", 503)
    }
    throw error
  }

  // A new key per take, so players and exports never serve a stale file.
  const voiceKey = `uploads/${upload.id}/voiceover-${Date.now()}.mp3`
  await env.BUCKET.put(voiceKey, audio, { httpMetadata: { contentType: "audio/mpeg" } })
  if (upload.voiceKey) await env.BUCKET.delete(upload.voiceKey).catch(() => {})
  await db
    .update(uploads)
    .set({ voiceKey, voiceText: input.text, voiceVoiceId: input.voiceId, voiceVoiceName: input.voiceName.slice(0, 80), voiceModel: model.id })
    .where(eq(uploads.id, upload.id))
  return { ...upload, voiceKey, voiceText: input.text, voiceVoiceId: input.voiceId, voiceVoiceName: input.voiceName.slice(0, 80), voiceModel: model.id }
}

export async function removeVoiceover(upload: Upload): Promise<void> {
  if (upload.voiceKey) await env.BUCKET.delete(upload.voiceKey).catch(() => {})
  await db
    .update(uploads)
    .set({ voiceKey: null, voiceText: null, voiceVoiceId: null, voiceVoiceName: null, voiceModel: null, voiceOffset: 0 })
    .where(eq(uploads.id, upload.id))
}

/**
 * Narration for an agent-recorded tutorial: one clip per step, in the workspace's own voice account or Vertov voices
 * (credits taken up front for the whole script, refunded by the caller if the recording then fails).
 * Null when the workspace has no way to speak; the recording is then silent and paced from the script.
 */
export async function narrationClips(
  workspaceId: string,
  userId: string,
  steps: Array<{ id: string; text: string }>,
  voiceId: string | null,
  ref: string,
): Promise<{ clips: Record<string, string>; credits: number; voiceName: string } | null> {
  const source = await voiceSource(workspaceId)
  if (!source) return null
  const { key, managed } = source
  const model = defaultModel(await listModels(key))
  if (!model) return null
  const voices = await sourceVoices(source)
  const voice = (voiceId && voices.find((candidate) => candidate.id === voiceId)) || voices.find((candidate) => candidate.category === "premade") || voices[0]
  if (!voice) return null
  const cost = steps.reduce((sum, step) => sum + step.text.length, 0)
  if (managed) {
    await grantStarterCredits(workspaceId, userId)
    if (!(await spendVoiceCredits(workspaceId, cost, ref))) throw new VoiceoverError("You don't have enough voice credits for this tutorial's narration.", 402)
  }
  try {
    const clips: Record<string, string> = {}
    for (const step of steps) {
      const speech = await eleven(key, `/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: step.text, model_id: model.id }),
      })
      const audio = new Uint8Array(await speech.arrayBuffer())
      if (audio.byteLength < 1000) throw new VoiceoverError("The voice service sent back no audio.", 502)
      clips[step.id] = Buffer.from(audio).toString("base64")
    }
    return { clips, credits: managed ? cost : 0, voiceName: voice.name }
  } catch (error) {
    if (managed) await adjustVoiceCredits(workspaceId, cost, "refund", ref)
    throw error
  }
}
