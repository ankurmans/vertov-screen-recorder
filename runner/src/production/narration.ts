import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { estimateSeconds, fill, wordCount } from "../../../src/lib/tutorials/recipe"
import type { Recipe } from "../../../src/lib/tutorials/recipe"
import type { NarrationPlan, RunnerLogger, StepNarration } from "../types"
import { probeSeconds, run } from "./media"

/**
 * Narration for each step, produced before the browser starts so the footage can be paced to it.
 * Modes (TUTORIAL_NARRATION): fixture (default, silence), file (approved audio on disk), elevenlabs (paid, needs confirmation).
 */

const ELEVEN = "https://api.elevenlabs.io"
// Personal presenter assets live beside the repo, never in it; override with TUTORIAL_PRESENTER_PROFILE.
const PROFILE_PATH = process.env.TUTORIAL_PRESENTER_PROFILE ?? fileURLToPath(new URL("../../../../tutorial-assets/ankur/tutorial-presenter-profile.json", import.meta.url))
const VOICE_NAME = "Ankur DJI"
const WPM_LOW = 165
const WPM_HIGH = 180
/** ElevenLabs documents `speed` on voice settings; 0.7–1.2 is the range its apps and API accept. */
const SPEED_MIN = 0.7
const SPEED_MAX = 1.2
const MAX_ATTEMPTS = 2

type Mode = "fixture" | "file" | "elevenlabs"

const mode = (): Mode => {
  const value = process.env.TUTORIAL_NARRATION ?? "fixture"
  if (value !== "fixture" && value !== "file" && value !== "elevenlabs") throw new Error(`TUTORIAL_NARRATION must be fixture, file or elevenlabs, not “${value}”`)
  return value
}

/** The narration of a step with its placeholders filled; the recipe passed in is normally already bound. */
const spoken = (recipe: Recipe, text: string) => fill(text, Object.fromEntries(recipe.parameters.map((p) => [p.name, p.default])))

export function narrationCostEstimate(recipe: Recipe): { characters: number; words: number; seconds: number; note: string } {
  const texts = recipe.steps.map((step) => spoken(recipe, step.narration))
  const characters = texts.reduce((sum, text) => sum + text.length, 0)
  const words = texts.reduce((sum, text) => sum + wordCount(text), 0)
  const seconds = texts.reduce((sum, text) => sum + estimateSeconds(text), 0)
  return {
    characters,
    words,
    seconds,
    note: `${characters} characters (~${Math.round(seconds)}s of speech) billed as ElevenLabs text-to-speech credits on the model chosen at run time; a retry at a different speed re-bills that step.`,
  }
}

export async function prepareNarration(recipe: Recipe, opts: { workdir: string; presenter: boolean; logger: RunnerLogger }): Promise<NarrationPlan> {
  const audioDir = join(opts.workdir, "narration")
  await mkdir(audioDir, { recursive: true })
  const selected = mode()
  if (selected === "fixture") return fixturePlan(recipe, audioDir)
  if (selected === "file") return filePlan(recipe, audioDir, opts.logger)
  return elevenLabsPlan(recipe, audioDir, opts)
}

function planOf(steps: Array<StepNarration>, voice: string, synthesized: boolean): NarrationPlan {
  const words = steps.reduce((sum, step) => sum + wordCount(step.text), 0)
  const seconds = steps.reduce((sum, step) => sum + step.seconds, 0)
  return { steps, voice, synthesized, wpm: seconds > 0 ? (words / seconds) * 60 : 0 }
}

async function fixturePlan(recipe: Recipe, audioDir: string): Promise<NarrationPlan> {
  const steps: Array<StepNarration> = []
  for (const step of recipe.steps) {
    const text = spoken(recipe, step.narration)
    const seconds = estimateSeconds(text)
    const audioPath = join(audioDir, `${step.id}.wav`)
    await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", seconds.toFixed(3), audioPath])
    steps.push({ stepId: step.id, text, audioPath, seconds })
  }
  return planOf(steps, "fixture-silence", false)
}

async function filePlan(recipe: Recipe, audioDir: string, logger: RunnerLogger): Promise<NarrationPlan> {
  const dir = process.env.TUTORIAL_NARRATION_DIR
  if (!dir) throw new Error("TUTORIAL_NARRATION=file needs TUTORIAL_NARRATION_DIR (a folder of <stepId>.mp3 or .wav files)")
  const available = new Set(await readdir(dir))
  const steps: Array<StepNarration> = []
  for (const step of recipe.steps) {
    const name = [`${step.id}.mp3`, `${step.id}.wav`].find((candidate) => available.has(candidate))
    if (!name) throw new Error(`No approved audio for step “${step.id}” in ${dir} (expected ${step.id}.mp3 or ${step.id}.wav)`)
    const audioPath = join(audioDir, name)
    await copyFile(join(dir, name), audioPath)
    const seconds = await probeSeconds(audioPath)
    const text = spoken(recipe, step.narration)
    logger.info(`Narration for ${step.id}: approved audio, ${seconds.toFixed(1)}s`)
    steps.push({ stepId: step.id, text, audioPath, seconds })
  }
  return planOf(steps, "approved-audio", true)
}

// --- ElevenLabs ---

async function apiKey(): Promise<string> {
  const fromEnv = process.env.ELEVENLABS_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const text = await readFile(join(homedir(), ".config", "vertov", "elevenlabs.env"), "utf8").catch(() => "")
  const match = /^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/m.exec(text)
  if (match) return match[1]
  throw new Error("No ElevenLabs key. Set ELEVENLABS_API_KEY or put it in ~/.config/vertov/elevenlabs.env (never in chat or git).")
}

interface Pin {
  voiceId: string
  voiceName: string
  modelId: string
  speed: number
}

interface ModelInfo {
  model_id: string
  name?: string
  can_do_text_to_speech?: boolean
  maximum_text_length_per_request?: number
}

async function eleven(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${ELEVEN}${path}`, { ...init, headers: { "xi-api-key": key, ...(init.headers as Record<string, string> | undefined) } })
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200).replace(key, "[key]")
    throw new Error(`ElevenLabs ${path.split("?")[0]} failed (${response.status}): ${detail}`)
  }
  return response
}

/** The model must come from the account's own model list; “v4” is a product name, not an id we assume. */
async function resolveModel(key: string, preferred: string | null): Promise<string> {
  const models = (await (await eleven(key, "/v1/models")).json()) as Array<ModelInfo>
  const tts = models.filter((model) => model.can_do_text_to_speech)
  const ids = tts.map((model) => model.model_id)
  const override = process.env.TUTORIAL_ELEVENLABS_MODEL?.trim()
  const want = override || preferred
  if (want) {
    if (ids.includes(want)) return want
    throw new Error(`ElevenLabs model “${want}” is not available for text-to-speech on this account. Available TTS models: ${ids.join(", ") || "none"}`)
  }
  const v4 = tts.find((model) => /v4/i.test(model.model_id) || /\bv4\b/i.test(model.name ?? ""))
  if (v4) return v4.model_id
  throw new Error(`Could not confirm an Eleven v4 text-to-speech model on this account. Available TTS models: ${ids.join(", ") || "none"}. Set TUTORIAL_ELEVENLABS_MODEL to one of them.`)
}

async function resolveVoice(key: string, pinnedId: string | null): Promise<{ id: string; name: string }> {
  const response = await eleven(key, `/v2/voices?search=${encodeURIComponent(VOICE_NAME)}&page_size=100`)
  const { voices } = (await response.json()) as { voices: Array<{ voice_id: string; name: string }> }
  const exact = voices.filter((voice) => voice.name === VOICE_NAME)
  if (pinnedId) {
    const match = exact.find((voice) => voice.voice_id === pinnedId)
    if (!match) throw new Error(`The pinned voice id ${pinnedId} is not an exact “${VOICE_NAME}” voice on this account`)
    return { id: match.voice_id, name: match.name }
  }
  if (exact.length !== 1) throw new Error(exact.length ? `More than one voice is named “${VOICE_NAME}”; pin one in the presenter profile` : `No voice named exactly “${VOICE_NAME}” on this account`)
  return { id: exact[0].voice_id, name: exact[0].name }
}

async function pinnedProfile(): Promise<{ voice_id?: string; model_id?: string } | null> {
  const path = process.env.TUTORIAL_PRESENTER_PROFILE ?? PROFILE_PATH
  return readFile(path, "utf8").then((text) => JSON.parse(text), () => null)
}

/** Voice, model and speed are decided once per workdir and reused, so a retry never switches them quietly. */
async function pinFor(key: string, workdir: string): Promise<Pin> {
  const path = join(workdir, "voice-pin.json")
  const cached = await readFile(path, "utf8").then((text) => JSON.parse(text) as Pin, () => null)
  if (cached) return cached
  const profile = await pinnedProfile()
  const voice = await resolveVoice(key, profile?.voice_id ?? null)
  const modelId = await resolveModel(key, profile?.model_id ?? null)
  const pin: Pin = { voiceId: voice.id, voiceName: voice.name, modelId, speed: 1 }
  await writeFile(path, JSON.stringify(pin, null, 2))
  return pin
}

async function elevenLabsPlan(recipe: Recipe, audioDir: string, opts: { workdir: string; logger: RunnerLogger }): Promise<NarrationPlan> {
  const { logger } = opts
  const estimate = narrationCostEstimate(recipe)
  logger.info("Narration script (ElevenLabs):")
  for (const step of recipe.steps) logger.info(`  [${step.id}] ${spoken(recipe, step.narration)}`)
  logger.info(`Paid usage estimate: ${estimate.note}`)
  if (process.env.TUTORIAL_NARRATION_CONFIRMED !== "1") throw new Error("Paid narration not confirmed. Review the script above, then set TUTORIAL_NARRATION_CONFIRMED=1 to synthesise it.")

  const key = await apiKey()
  const pin = await pinFor(key, opts.workdir)
  logger.info(`Voice “${pin.voiceName}”, model ${pin.modelId}`)
  const steps: Array<StepNarration> = []
  for (const step of recipe.steps) {
    const text = spoken(recipe, step.narration)
    const { path, seconds } = await synthesizeStep(key, pin, text, audioDir, step.id, logger)
    steps.push({ stepId: step.id, text, audioPath: path, seconds })
  }
  return planOf(steps, pin.voiceName, true)
}

const hash = (parts: Array<string | number>) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16)

async function synthesizeStep(key: string, pin: Pin, text: string, audioDir: string, stepId: string, logger: RunnerLogger): Promise<{ path: string; seconds: number }> {
  const words = wordCount(text)
  let speed = pin.speed
  let best: { path: string; seconds: number; distance: number } | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const path = join(audioDir, `${stepId}-${hash([pin.voiceId, pin.modelId, speed, text])}.mp3`)
    const cached = await probeSeconds(path).then((seconds) => seconds, () => null)
    let seconds = cached
    if (seconds === null) {
      const response = await eleven(key, `/v1/text-to-speech/${pin.voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: pin.modelId, voice_settings: { speed } }),
      })
      await writeFile(path, Buffer.from(await response.arrayBuffer()))
      seconds = await probeSeconds(path)
    }
    const wpm = (words / seconds) * 60
    if (!best || Math.abs(wpm - 175) < best.distance) best = { path, seconds, distance: Math.abs(wpm - 175) }
    logger.info(`Step ${stepId}: ${seconds.toFixed(1)}s, ${Math.round(wpm)} WPM at speed ${speed.toFixed(2)}`)
    if (wpm >= WPM_LOW && wpm <= WPM_HIGH) return { path: best.path, seconds: best.seconds }
    if (attempt === MAX_ATTEMPTS) break
    const adjusted = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed * (175 / wpm)))
    if (Math.abs(adjusted - speed) < 0.02) break
    speed = Number(adjusted.toFixed(2))
  }
  logger.warn(`Step ${stepId} is outside ${WPM_LOW}–${WPM_HIGH} WPM after adjusting; using the closest take`)
  const closest = best as { path: string; seconds: number }
  return { path: closest.path, seconds: closest.seconds }
}
