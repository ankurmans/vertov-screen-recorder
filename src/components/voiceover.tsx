import { useEffect, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { askConfirm } from "@/components/app-dialog"
import { formatDuration } from "@/lib/format"

interface Voice {
  id: string
  name: string
  category: string | null
}
interface Model {
  id: string
  name: string
  maxCharacters: number | null
}
interface Connection {
  connected: boolean
  /** Vertov's own voices are on for this workspace: no key needed, narration spends credits. */
  managed?: boolean
  credits?: number
  canManage: boolean
  voices?: Array<Voice>
  models?: Array<Model>
  defaultModel?: string | null
}
interface Take {
  has: boolean
  text: string | null
  voiceId: string | null
  voiceName: string | null
  modelId: string | null
  offset: number
}

const LIMIT = 5000

const request = async <T,>(url: string, init?: RequestInit): Promise<{ ok: boolean; body: (T & { error?: string }) | null }> => {
  const response = await fetch(url, init).catch(() => null)
  const body = (await response?.json().catch(() => null)) as (T & { error?: string }) | null
  return { ok: Boolean(response?.ok), body }
}

/** Settings → Workspace: the workspace's own ElevenLabs key, which Voiceover speaks through. */
export function ElevenLabsSettings() {
  const [state, setState] = useState<Connection | null>(null)
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const load = () =>
    request<Connection>("/api/elevenlabs").then(({ ok, body }) => {
      if (ok && body) setState(body)
      else if (body?.error) setMessage({ text: body.error, error: true })
    })
  useEffect(() => {
    void load()
  }, [])

  async function connect() {
    setBusy(true)
    setMessage(null)
    const { ok, body } = await request<{ connected: boolean }>("/api/elevenlabs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    })
    setBusy(false)
    if (!ok) return setMessage({ text: body?.error ?? "That didn't work.", error: true })
    setKey("")
    setMessage({ text: "Connected. Open a video's Customize panel to add a voiceover." })
    await load()
  }

  async function disconnect() {
    if (!(await askConfirm({ title: "Disconnect ElevenLabs?", body: "Voiceovers already made stay on their videos. You can't make new ones until you connect a key again.", confirmLabel: "Disconnect", danger: true }))) return
    setBusy(true)
    await request("/api/elevenlabs", { method: "DELETE" })
    setBusy(false)
    setMessage(null)
    await load()
  }

  if (!state?.canManage) return null
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-neutral-900">ElevenLabs voiceover</h2>
      <p className="mt-1 text-sm text-neutral-500">
        {state.managed
          ? "Voiceover already works with Vertov voices and your credits. To use your own voices instead, connect your own ElevenLabs key: it's billed to your ElevenLabs account and costs no credits."
          : "Add a spoken voiceover to any video from a script, in your own ElevenLabs voice. It's billed to your ElevenLabs account, so Vertov never charges for it."}{" "}
        Give the key text to speech, voices read and models read.
      </p>
      {state.connected ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-neutral-700">Connected · {state.voices?.length ?? 0} voices</span>
          <button type="button" disabled={busy} onClick={() => void disconnect()} className="text-neutral-500 hover:text-red-600">
            Disconnect
          </button>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void connect()
          }}
        >
          <input
            required
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="ElevenLabs API key"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Checking…" : "Connect"}
          </button>
        </form>
      )}
      {message && <p className={`mt-3 text-sm ${message.error ? "text-red-600" : "text-green-600"}`}>{message.text}</p>}
    </section>
  )
}

/** Customize → Voiceover: write a script, pick a voice, and it plays with the video and exports into the MP4. */
export function VoiceoverPanel({ uploadId, currentTime, hasVoiceover }: { uploadId: string; currentTime: number; hasVoiceover: boolean }) {
  const router = useRouter()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [take, setTake] = useState<Take | null>(null)
  const [text, setText] = useState("")
  const [voiceId, setVoiceId] = useState("")
  const [modelId, setModelId] = useState("")
  const [busy, setBusy] = useState<"making" | "saving" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void request<Connection>("/api/elevenlabs").then(({ ok, body }) => {
      if (ok && body) {
        setConnection(body)
        setVoiceId((current) => current || body.voices?.[0]?.id || "")
      } else setError(body?.error ?? null)
    })
    void request<Take>(`/api/recordings/${uploadId}/voiceover`).then(({ ok, body }) => {
      if (!ok || !body) return
      setTake(body)
      if (body.text) setText(body.text)
      if (body.voiceId) setVoiceId(body.voiceId)
      if (body.modelId) setModelId(body.modelId)
    })
  }, [uploadId, hasVoiceover])

  async function make() {
    setBusy("making")
    setError(null)
    const voice = connection?.voices?.find((candidate) => candidate.id === voiceId)
    const { ok, body } = await request<Take>(`/api/recordings/${uploadId}/voiceover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voiceId, voiceName: voice?.name ?? "Voice", modelId: modelId || null }),
    })
    setBusy(null)
    if (!ok || !body) return setError(body?.error ?? "That didn't work. Try again.")
    setTake(body)
    if (connection?.managed) setConnection({ ...connection, credits: Math.max(0, (connection.credits ?? 0) - text.length) })
    router.invalidate()
  }

  async function setOffset(offset: number) {
    setBusy("saving")
    const { ok, body } = await request<Take>(`/api/recordings/${uploadId}/voiceover`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offset }),
    })
    setBusy(null)
    if (ok && body) {
      setTake(body)
      router.invalidate()
    }
  }

  async function remove() {
    if (!(await askConfirm({ title: "Remove the voiceover?", body: "The video goes back to its own audio. You can make another from the script.", confirmLabel: "Remove", danger: true }))) return
    await request(`/api/recordings/${uploadId}/voiceover`, { method: "DELETE" })
    setTake(null)
    router.invalidate()
  }

  if (!connection) return error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null
  const models = connection.models ?? []
  const usable = connection.connected || Boolean(connection.managed)
  const credits = connection.credits ?? 0
  return (
    <div className="mt-6 border-t border-neutral-100 pt-4">
      <p className="mb-1.5 text-xs font-medium tracking-wide text-neutral-500 uppercase">Voiceover</p>
      {!usable ? (
        <p className="text-sm text-neutral-500">
          {connection.canManage ? (
            <>
              Add a spoken voiceover from a script in your own ElevenLabs voice. <a className="font-medium text-neutral-900 underline" href="/settings?tab=general">Connect ElevenLabs in Settings</a> first.
            </>
          ) : (
            "Ask a workspace admin to connect ElevenLabs in Settings to add voiceovers."
          )}
        </p>
      ) : (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, LIMIT))}
            rows={5}
            placeholder="Write what the voice should say. Short sentences read best."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1.5" aria-label="Voice">
              {connection.voices?.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                  {voice.category && voice.category !== "premade" ? ` (${voice.category})` : ""}
                </option>
              ))}
            </select>
            {models.length > 1 && (
              <select value={modelId || connection.defaultModel || ""} onChange={(event) => setModelId(event.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1.5" aria-label="Model">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={busy !== null || !text.trim() || !voiceId}
              onClick={() => void make()}
              className="rounded-lg bg-neutral-900 px-4 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              {busy === "making" ? "Making it…" : take?.has ? "Make it again" : "Make voiceover"}
            </button>
            <span className="text-xs text-neutral-400">
              {connection.managed
                ? `${text.length.toLocaleString()} / ${LIMIT.toLocaleString()} characters · uses ${text.length.toLocaleString()} credits, ${credits.toLocaleString()} left`
                : `${text.length.toLocaleString()} / ${LIMIT.toLocaleString()} characters, billed to your ElevenLabs account`}
            </span>
          </div>
          {take?.has && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600">
              <span>
                Spoken by {take.voiceName ?? "your voice"}, starts at {formatDuration(take.offset)}.
              </span>
              <button type="button" disabled={busy !== null} onClick={() => void setOffset(Math.max(0, Math.round(currentTime * 10) / 10))} className="rounded-lg border border-neutral-200 px-2.5 py-1 font-medium hover:bg-neutral-50">
                Start at {formatDuration(currentTime)}
              </button>
              <button type="button" onClick={() => void remove()} className="text-neutral-500 hover:text-red-600">
                Remove
              </button>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
