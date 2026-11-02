import { env } from "cloudflare:workers"

/**
 * One place that knows which AI runs. Text tries Claude (ANTHROPIC_API_KEY), then Groq (GROQ_API_KEY), then Workers AI through
 * the AI binding, which a self-hosted install already has with no key at all; a provider that fails hands over to the next.
 * Speech to text uses Groq when keyed and falls back to Workers AI (Claude has no audio input).
 */

const GATEWAY = { gateway: { id: "default" } }
const GROQ = "https://api.groq.com/openai/v1"
const WORKERS_WHISPER = "@cf/openai/whisper-large-v3-turbo"
const WORKERS_TEXT = "@cf/qwen/qwen3-30b-a3b-fp8"
const GROQ_WHISPER = "whisper-large-v3-turbo"
// Cheapest model that reliably keeps the JSON shape and writes in the transcript's language.
const GROQ_TEXT = "qwen/qwen3.8-27b"
// Groq takes files up to 25 MB as an attachment; larger audio goes to Workers AI.
const GROQ_MAX_BYTES = 25 * 1024 * 1024

const groqKey = () => {
  const key = Reflect.get(env, "GROQ_API_KEY")
  return typeof key === "string" && key.trim() ? key.trim() : null
}

export const aiProvider = () => (groqKey() ? "groq" : "workers-ai")

export interface SpokenSegment {
  start: number
  end: number
  text: string
}

export interface SpokenWord {
  word: string
  start: number
  end: number
}

export interface Transcription {
  segments: Array<SpokenSegment>
  words: Array<SpokenWord>
  /** ISO 639-1 code, or null when the model didn't say. */
  language: string | null
  /** Audio length in seconds when known, for files that arrived without one. */
  duration: number | null
}

export interface TranscribeOptions {
  /** ISO 639-1 code to force; leave unset to let Whisper detect. */
  language?: string | null
  /** Style prompt; must be in the audio's own language. */
  prompt?: string | null
}

export async function transcribe(audio: Uint8Array, contentType: string, options: TranscribeOptions = {}): Promise<Transcription> {
  const key = groqKey()
  if (key && audio.byteLength <= GROQ_MAX_BYTES) {
    try {
      return await groqTranscribe(key, audio, contentType, options)
    } catch (error) {
      console.warn("Groq transcription failed, using Workers AI", error instanceof Error ? error.message : error)
    }
  }
  return workersTranscribe(audio, options)
}

interface GroqTranscription {
  language?: string
  duration?: number
  segments?: Array<SpokenSegment>
  words?: Array<SpokenWord>
}

async function groqTranscribe(key: string, audio: Uint8Array, contentType: string, options: TranscribeOptions): Promise<Transcription> {
  const form = new FormData()
  const type = contentType.split(";")[0].trim() || "audio/webm"
  form.append("file", new Blob([new Uint8Array(audio)], { type }), `audio.${extensionFor(type)}`)
  form.append("model", GROQ_WHISPER)
  form.append("response_format", "verbose_json")
  form.append("timestamp_granularities[]", "word")
  form.append("timestamp_granularities[]", "segment")
  form.append("temperature", "0")
  if (options.language) form.append("language", options.language)
  if (options.prompt) form.append("prompt", options.prompt)
  const response = await fetch(`${GROQ}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  })
  if (!response.ok) throw new Error(`Groq transcription failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const body: GroqTranscription = await response.json()
  return {
    segments: (body.segments ?? []).map(({ start, end, text }) => ({ start, end, text })),
    words: body.words ?? [],
    language: languageCode(body.language),
    duration: typeof body.duration === "number" ? body.duration : null,
  }
}

async function workersTranscribe(audio: Uint8Array, options: TranscribeOptions): Promise<Transcription> {
  const output = (await env.AI.run(
    WORKERS_WHISPER,
    {
      audio: toBase64(audio),
      vad_filter: true,
      ...(options.language ? { language: options.language } : {}),
      ...(options.prompt ? { initial_prompt: options.prompt } : {}),
    },
    GATEWAY,
  )) as {
    transcription_info?: { language?: string }
    segments?: Array<SpokenSegment & { words?: Array<SpokenWord> }>
  }
  const segments = output.segments ?? []
  return {
    segments: segments.map(({ start, end, text }) => ({ start, end, text })),
    words: segments.flatMap((segment) => segment.words ?? []),
    language: languageCode(output.transcription_info?.language),
    duration: (output.transcription_info as { duration?: number } | undefined)?.duration ?? segments.at(-1)?.end ?? null,
  }
}

const ANTHROPIC = "https://api.anthropic.com/v1/messages"
const ANTHROPIC_MODEL = "claude-sonnet-5-5"
// A provider that just failed (no credit left, bad key, outage) is skipped for a few minutes instead of slowing every call.
const COOLDOWN_MS = 5 * 60 * 1000
const coolingUntil = new Map<string, number>()

const secret = (name: string) => {
  const value = Reflect.get(env, name)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

type TextProvider = "anthropic" | "groq" | "workers"

/** Text providers in the order to try them: AI_CHAIN (comma separated) or Claude, Groq, then Workers AI. Unconfigured ones drop out. */
function textChain(): Array<TextProvider> {
  const wanted = (secret("AI_CHAIN") ?? "anthropic,groq,workers").split(",").map((name) => name.trim())
  const chain = wanted.filter((name): name is TextProvider => name === "anthropic" || name === "groq" || name === "workers")
  return chain.filter((name) => (name === "anthropic" ? Boolean(secret("ANTHROPIC_API_KEY")) : name === "groq" ? Boolean(groqKey()) : true))
}

/** A JSON-only completion; returns the raw text for the caller to parse. Falls through the provider chain on any failure. */
export async function complete(system: string, user: string, maxTokens = 800): Promise<string> {
  const chain = textChain()
  const ready = chain.filter((name) => (coolingUntil.get(name) ?? 0) < Date.now())
  // If everything is cooling down, try them all anyway rather than fail outright.
  const order = ready.length ? ready : chain
  let lastError: unknown = new Error("No AI provider is configured")
  for (const name of order) {
    try {
      const text = name === "anthropic" ? await anthropicComplete(system, user, maxTokens) : name === "groq" ? await groqComplete(system, user, maxTokens) : await workersComplete(system, user, maxTokens)
      if (text.trim()) {
        console.log(JSON.stringify({ message: "AI completion succeeded", provider: name }))
        return text
      }
      lastError = new Error(`${name} returned nothing`)
    } catch (error) {
      lastError = error
      coolingUntil.set(name, Date.now() + COOLDOWN_MS)
      console.warn(`AI provider ${name} failed, trying the next`, error instanceof Error ? error.message : error)
    }
  }
  throw lastError
}

async function anthropicComplete(system: string, user: string, maxTokens: number): Promise<string> {
  const response = await fetch(ANTHROPIC, {
    method: "POST",
    headers: { "x-api-key": secret("ANTHROPIC_API_KEY") ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: secret("ANTHROPIC_MODEL") ?? ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  })
  if (!response.ok) throw new Error(`Claude completion failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const body: { content?: Array<{ type?: string; text?: string }> } = await response.json()
  return (body.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("")
}

async function groqComplete(system: string, user: string, maxTokens: number): Promise<string> {
  const response = await fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${groqKey()}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: GROQ_TEXT,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: maxTokens,
      temperature: 0.2,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    }),
  })
  if (!response.ok) throw new Error(`Groq completion failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const body: { choices?: Array<{ message?: { content?: string } }> } = await response.json()
  return body.choices?.[0]?.message?.content ?? ""
}

async function workersComplete(system: string, user: string, maxTokens: number): Promise<string> {
  const result = (await env.AI.run(
    WORKERS_TEXT,
    {
      messages: [
        { role: "system", content: `${system} /no_think` },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    },
    GATEWAY,
  )) as { response?: unknown; choices?: Array<{ message?: { content?: string } }> }
  if (typeof result.response === "string") return result.response
  if (typeof result.response === "object" && result.response !== null) return JSON.stringify(result.response)
  return result.choices?.[0]?.message?.content ?? ""
}

function extensionFor(type: string): string {
  if (type.includes("wav")) return "wav"
  if (type.includes("mp4") || type.includes("m4a")) return "mp4"
  if (type.includes("ogg")) return "ogg"
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3"
  return "webm"
}

// Whisper reports languages by English name on the OpenAI-style API and by code on Workers AI.
const LANGUAGE_CODES: Record<string, string> = {
  afrikaans: "af", arabic: "ar", armenian: "hy", azerbaijani: "az", belarusian: "be", bengali: "bn", bosnian: "bs",
  bulgarian: "bg", catalan: "ca", chinese: "zh", croatian: "hr", czech: "cs", danish: "da", dutch: "nl", english: "en",
  estonian: "et", finnish: "fi", french: "fr", galician: "gl", german: "de", greek: "el", gujarati: "gu", hebrew: "he",
  hindi: "hi", hungarian: "hu", icelandic: "is", indonesian: "id", italian: "it", japanese: "ja", kannada: "kn",
  kazakh: "kk", korean: "ko", latvian: "lv", lithuanian: "lt", macedonian: "mk", malay: "ms", malayalam: "ml",
  marathi: "mr", maori: "mi", nepali: "ne", norwegian: "no", persian: "fa", polish: "pl", portuguese: "pt",
  punjabi: "pa", romanian: "ro", russian: "ru", serbian: "sr", slovak: "sk", slovenian: "sl", spanish: "es",
  swahili: "sw", swedish: "sv", tagalog: "tl", tamil: "ta", telugu: "te", thai: "th", turkish: "tr", ukrainian: "uk",
  urdu: "ur", vietnamese: "vi", welsh: "cy",
}

export function languageCode(value: string | null | undefined): string | null {
  const raw = value?.trim().toLowerCase()
  if (!raw) return null
  if (/^[a-z]{2,3}$/.test(raw)) return raw
  return LANGUAGE_CODES[raw] ?? null
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
