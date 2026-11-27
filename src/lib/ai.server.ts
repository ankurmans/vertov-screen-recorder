import { env } from "cloudflare:workers"

/**
 * One place that knows which AI runs. Text tries Claude (ANTHROPIC_API_KEY), then Groq (GROQ_API_KEY), then OpenAI (OPENAI_API_KEY); a provider that fails
 * or times out hands over to the next. Workers AI is not a text fallback (owner directive 2026-11-10).
 * The "eu" text route is Mistral's EU endpoint alone, with no fallback (owner decision 2026-11-25).
 * Speech to text uses Groq when keyed and falls back to Workers AI (Claude has no audio input).
 */

const GATEWAY = { gateway: { id: "default" } }
const GROQ = "https://api.groq.com/openai/v1"
const WORKERS_WHISPER = "@cf/openai/whisper-large-v3-turbo"
const GROQ_WHISPER = "whisper-large-v3-turbo"
// Text fallback when Claude fails. openai/gpt-oss-20b (GROQ_TEXT_MODEL) was tried on 2026-11-10 and answered Spanish and French
// transcripts in English; this one kept their language (docs/ai-policy.md).
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
// Owner directive 2026-11-10: Haiku for routine extraction and translation, Sonnet for written documents (docs/ai-policy.md).
const ANTHROPIC_ROUTINE = "claude-haiku-5-5"
const ANTHROPIC_DOCUMENT = "claude-sonnet-5-5"
// A hung provider hands over to the next instead of holding the request; AI_TEXT_TIMEOUT_MS overrides both.
const TIMEOUT_MS: Record<TextTask, number> = { routine: 30_000, document: 60_000 }
// A provider that just failed (no credit left, bad key, outage) is skipped for a few minutes instead of slowing every call.
const COOLDOWN_MS = 5 * 60 * 1000
const coolingUntil = new Map<string, number>()
const OPENAI = "https://api.openai.com/v1/chat/completions"
// Third in line, on the owner's OpenAI credits (owner directive 2026-11-21: "a cheaper OpenAI model"). Cheapest current model.
const OPENAI_TEXT = "gpt-6-luna"
const PROVIDERS = ["anthropic", "groq", "openai"] as const
// The "eu" route (owner decision 2026-11-25, docs/ai-policy.md). Mistral's regional EU host, fixed here on purpose: the global
// api.mistral.ai makes no location promise. Not part of AI_CHAIN, so the standard route never reaches it.
const MISTRAL_EU = "https://api.eu.mistral.ai/v1/chat/completions"
const MISTRAL_TEXT = "mistral-small-2603"
// A long recording can ask for more than fits: SOPs and checklists ran to the budget until told how long to be.
// Worded as a ceiling only: asking for a "complete" document turned the short share message into pages (measured).
const MISTRAL_DOCUMENT_LENGTH = "Keep to the length asked for above. Never exceed 1,000 words: when there is more to say, group repeated or minor points. Reply with the one JSON key \"text\", holding the whole document, any subject line included."
// Output room on top of the caller's budget. Documents from a long recording overran 2,000 tokens on Small, and Large 4
// always reasons out of max_tokens (docs/ai-policy.md).
const MISTRAL_EXTRA_ROOM = 4000

const secret = (name: string) => {
  const value = Reflect.get(env, name)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

type ChainProvider = (typeof PROVIDERS)[number]
type TextProvider = ChainProvider | "mistral"
/** Standard: the AI_CHAIN providers. EU: Mistral's EU endpoint only. The caller decides, from the account that owns the content. */
export type TextRoute = "standard" | "eu"
/** Routine: titles, summaries, chapters, caption translation. Document: the written AI documents. */
export type TextTask = "routine" | "document"

export interface CompleteOptions {
  /** Names the feature in usage logs, e.g. "metadata", "translation", "document:sop". Never content. */
  caller: string
  /** Required, so no feature can send content without saying where it may go. */
  route: TextRoute
  task?: TextTask
  /** ISO 639-1 code of the content, when the answer must stay in its language. Only the EU route needs telling. */
  language?: string | null
  /** Aborting stops the call where it is: no fallback, no cooldown. */
  signal?: AbortSignal
}

/** The model a provider uses for a task: its default, or ANTHROPIC_MODEL / ANTHROPIC_DOCUMENT_MODEL / GROQ_TEXT_MODEL / OPENAI_TEXT_MODEL / MISTRAL_TEXT_MODEL / MISTRAL_DOCUMENT_MODEL from the Worker's variables. */
const textModel = (name: TextProvider, task: TextTask) =>
  name === "mistral"
    ? (secret(task === "document" ? "MISTRAL_DOCUMENT_MODEL" : "MISTRAL_TEXT_MODEL") ?? MISTRAL_TEXT)
    : name === "groq"
    ? (secret("GROQ_TEXT_MODEL") ?? GROQ_TEXT)
    : name === "openai"
      ? (secret("OPENAI_TEXT_MODEL") ?? OPENAI_TEXT)
      : task === "document"
      ? (secret("ANTHROPIC_DOCUMENT_MODEL") ?? ANTHROPIC_DOCUMENT)
      : (secret("ANTHROPIC_MODEL") ?? ANTHROPIC_ROUTINE)

const requestedChain = () => (secret("AI_CHAIN") ?? "anthropic,groq,openai").split(",").map((name) => name.trim()).filter(Boolean)

/** Text providers in the order to try them: AI_CHAIN (comma separated) or Claude, Groq, then OpenAI. Unknown names and unkeyed providers drop out. */
function textChain(): Array<ChainProvider> {
  const chain = requestedChain().filter((name): name is ChainProvider => (PROVIDERS as ReadonlyArray<string>).includes(name))
  return chain.filter((name) => (name === "anthropic" ? Boolean(secret("ANTHROPIC_API_KEY")) : name === "openai" ? Boolean(secret("OPENAI_API_KEY")) : Boolean(groqKey())))
}

/**
 * The providers for a route. "eu" is Mistral and nothing else: when it fails the caller gets the error, and the content never
 * moves to another provider. Until MISTRAL_API_KEY is set the route is off and the standard providers answer, with a warning.
 */
function providersFor(route: TextRoute): Array<TextProvider> {
  if (route !== "eu") return textChain()
  if (secret("MISTRAL_API_KEY")) return ["mistral"]
  console.warn("EU text route is off: MISTRAL_API_KEY is not set, using the standard providers")
  return textChain()
}

const coolingSeconds = (name: TextProvider) => Math.max(0, Math.ceil(((coolingUntil.get(name) ?? 0) - Date.now()) / 1000))

const timeoutMs = (task: TextTask) => Number(secret("AI_TEXT_TIMEOUT_MS")) || TIMEOUT_MS[task]

/** What `complete()` would do right now, for the operator: provider order, exact model IDs per task, which providers are keyed and which are cooling down after a failure. No keys or prompts. */
export function textConfig() {
  const requested = requestedChain()
  return {
    requestedOrder: requested,
    ignored: requested.filter((name) => !(PROVIDERS as ReadonlyArray<string>).includes(name)),
    effectiveOrder: textChain().map((name) => ({
      provider: name,
      models: { routine: textModel(name, "routine"), document: textModel(name, "document") },
      coolingDownSeconds: coolingSeconds(name),
    })),
    euRoute: {
      active: Boolean(secret("MISTRAL_API_KEY")),
      provider: "mistral",
      endpoint: MISTRAL_EU,
      models: { routine: textModel("mistral", "routine"), document: textModel("mistral", "document") },
      coolingDownSeconds: coolingSeconds("mistral"),
    },
    timeoutsMs: { routine: timeoutMs("routine"), document: timeoutMs("document") },
    overrides: {
      AI_CHAIN: secret("AI_CHAIN") !== null,
      ANTHROPIC_MODEL: secret("ANTHROPIC_MODEL") !== null,
      ANTHROPIC_DOCUMENT_MODEL: secret("ANTHROPIC_DOCUMENT_MODEL") !== null,
      GROQ_TEXT_MODEL: secret("GROQ_TEXT_MODEL") !== null,
      OPENAI_TEXT_MODEL: secret("OPENAI_TEXT_MODEL") !== null,
      MISTRAL_TEXT_MODEL: secret("MISTRAL_TEXT_MODEL") !== null,
      MISTRAL_DOCUMENT_MODEL: secret("MISTRAL_DOCUMENT_MODEL") !== null,
      AI_TEXT_TIMEOUT_MS: secret("AI_TEXT_TIMEOUT_MS") !== null,
    },
    keys: { anthropic: Boolean(secret("ANTHROPIC_API_KEY")), groq: Boolean(groqKey()), openai: Boolean(secret("OPENAI_API_KEY")), mistral: Boolean(secret("MISTRAL_API_KEY")) },
    speech: { groq: GROQ_WHISPER, workers: WORKERS_WHISPER },
  }
}

interface TextResult {
  text: string
  inputTokens: number | null
  outputTokens: number | null
  stopReason: string | null
}

/**
 * A JSON-only completion; returns the raw text for the caller to parse. On the standard route it falls through the provider chain
 * on an error, a timeout or an empty reply. Logs one usage line per attempt: caller, route, provider, model, tokens, outcome.
 * Never the prompt or the reply.
 */
export async function complete(system: string, user: string, maxTokens: number, options: CompleteOptions): Promise<string> {
  const task = options.task ?? "routine"
  const chain = providersFor(options.route)
  const ready = chain.filter((name) => (coolingUntil.get(name) ?? 0) < Date.now())
  // If everything is cooling down, try them all anyway rather than fail outright.
  const order = ready.length ? ready : chain
  let lastError: unknown = new Error("No AI provider is configured")
  for (const name of order) {
    options.signal?.throwIfAborted()
    const model = textModel(name, task)
    const started = Date.now()
    const timeout = AbortSignal.timeout(timeoutMs(task))
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const usage = (outcome: string, result?: TextResult) =>
      console.log(JSON.stringify({
        message: "AI text usage",
        caller: options.caller,
        route: options.route,
        task,
        provider: name,
        model,
        outcome,
        fallback: name !== order[0],
        inputTokens: result?.inputTokens ?? null,
        outputTokens: result?.outputTokens ?? null,
        stopReason: result?.stopReason ?? null,
        ms: Date.now() - started,
      }))
    try {
      const result =
        name === "mistral"
          ? await mistralComplete(model, task, system, inLanguage(task === "document" ? `${user}\n\n${MISTRAL_DOCUMENT_LENGTH}` : user, options.language), maxTokens, signal)
          : name === "anthropic"
          ? await anthropicComplete(model, system, user, maxTokens, signal)
          : name === "groq"
            ? await groqComplete(model, system, user, maxTokens, signal)
            : await openaiComplete(model, system, user, maxTokens, signal)
      if (result.text.trim()) {
        usage("ok", result)
        return result.text
      }
      usage("empty", result)
      lastError = new Error(`${name} returned nothing`)
    } catch (error) {
      if (options.signal?.aborted) {
        usage("cancelled")
        throw options.signal.reason
      }
      usage(timeout.aborted ? "timeout" : "error")
      lastError = timeout.aborted ? new Error(`${name} (${model}) timed out after ${timeoutMs(task)} ms`) : error
      coolingUntil.set(name, Date.now() + COOLDOWN_MS)
      console.warn(`AI provider ${name} (${model}) failed${name === order.at(-1) ? "" : ", trying the next"}`, lastError instanceof Error ? lastError.message : lastError)
    }
  }
  throw lastError
}

/** No thinking on these one-shot JSON calls, so the caller's max_tokens budget goes to the answer. Each model family turns it off its own way. */
const anthropicThinking = (model: string) =>
  model.startsWith("claude-haiku") ? { thinking: { type: "disabled" } } : model.startsWith("claude-sonnet-5-5") ? { thinking: { type: "between_tools" } } : { output_config: { effort: "low" } }

async function anthropicComplete(model: string, system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<TextResult> {
  const response = await fetch(ANTHROPIC, {
    method: "POST",
    headers: { "x-api-key": secret("ANTHROPIC_API_KEY") ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...anthropicThinking(model),
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Claude completion failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const body: { content?: Array<{ type?: string; text?: string }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } } = await response.json()
  if (body.stop_reason === "refusal") throw new Error("Claude declined the request")
  return {
    text: (body.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join(""),
    inputTokens: body.usage?.input_tokens ?? null,
    outputTokens: body.usage?.output_tokens ?? null,
    stopReason: body.stop_reason ?? null,
  }
}

async function groqComplete(model: string, system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<TextResult> {
  // GPT-OSS always reasons (low is its least) and is told not to return the reasoning; Qwen 3 can switch it off.
  const reasoning = model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : { reasoning_effort: "none" }
  const response = await fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${groqKey()}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: maxTokens,
      temperature: 0.2,
      ...reasoning,
      response_format: { type: "json_object" },
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Groq completion failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const body: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } = await response.json()
  return {
    text: body.choices?.[0]?.message?.content ?? "",
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    stopReason: body.choices?.[0]?.finish_reason ?? null,
  }
}

async function openaiComplete(model: string, system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<TextResult> {
  // Reasoning tokens count against max_completion_tokens, so turn reasoning off where the model allows it (Luna, Terra) and keep it
  // at its least elsewhere. No temperature: OpenAI's reasoning models don't take one.
  const effort = /^gpt-6(\.1)?-(luna|terra)/.test(model) ? "none" : "low"
  const response = await fetch(OPENAI, {
    method: "POST",
    headers: { authorization: `Bearer ${secret("OPENAI_API_KEY") ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: maxTokens,
      reasoning_effort: effort,
      response_format: { type: "json_object" },
    }),
    signal,
  })
  if (!response.ok) throw new Error(`OpenAI completion failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const body: { choices?: Array<{ message?: { content?: string; refusal?: string | null }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } = await response.json()
  if (body.choices?.[0]?.message?.refusal) throw new Error("OpenAI declined the request")
  return {
    text: body.choices?.[0]?.message?.content ?? "",
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    stopReason: body.choices?.[0]?.finish_reason ?? null,
  }
}

/**
 * Mistral Small drifts to English on other languages (measured 2026-11-25: French transcripts 9 times in 10) because our
 * instructions are English. Naming the content's language after them fixed it; asking for "the same language" did not.
 */
function inLanguage(user: string, code: string | null | undefined): string {
  if (!code || !/^[a-z]{2,3}$/.test(code)) return user
  const name = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(code)
  return name ? `${user}\n\nThe transcript is in ${name}. Keep the JSON keys exactly as given and write every text value in ${name}.` : user
}

async function mistralComplete(model: string, task: TextTask, system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<TextResult> {
  // Small switches reasoning off; Large's least is low. Other models get no setting, since not all of them accept one.
  const large = model.startsWith("mistral-large")
  const reasoning = model.startsWith("mistral-small") ? { reasoning_effort: "none" } : large ? { reasoning_effort: "low" } : {}
  const response = await fetch(MISTRAL_EU, {
    method: "POST",
    headers: { authorization: `Bearer ${secret("MISTRAL_API_KEY") ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: task === "document" || large ? maxTokens + MISTRAL_EXTRA_ROOM : maxTokens,
      temperature: 0.2,
      ...reasoning,
      response_format: { type: "json_object" },
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Mistral completion failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const body: { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } = await response.json()
  // A reasoning reply comes as parts; only the text parts are the answer.
  const content = body.choices?.[0]?.message?.content
  return {
    text: typeof content === "string" ? content : (content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join(""),
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    stopReason: body.choices?.[0]?.finish_reason ?? null,
  }
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
