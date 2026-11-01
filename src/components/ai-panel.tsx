import { CopyIcon, SparkleIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

type Kind = "summary-doc" | "sop" | "bug-report" | "meeting-notes" | "action-items" | "message"
type Docs = Partial<Record<Kind, { text: string; at: string }>>

const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: "summary-doc", label: "Doc" },
  { kind: "sop", label: "SOP" },
  { kind: "bug-report", label: "Bug report" },
  { kind: "meeting-notes", label: "Meeting notes" },
  { kind: "action-items", label: "Action items" },
  { kind: "message", label: "Message to send" },
]

/** Owner-only: turns the transcript into a written document, or a message to send with the link. */
export function AiPanel({ uploadId, className }: { uploadId: string; className?: string }) {
  const [state, setState] = useState<{ enabled: boolean; hasTranscript: boolean } | null>(null)
  const [docs, setDocs] = useState<Docs>({})
  const [kind, setKind] = useState<Kind>("summary-doc")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/ai/${uploadId}`)
      .then((response) => (response.ok ? response.json<{ enabled: boolean; hasTranscript: boolean; docs: Docs }>() : Promise.reject(new Error())))
      .then((body) => {
        if (cancelled) return
        setState({ enabled: body.enabled, hasTranscript: body.hasTranscript })
        setDocs(body.docs)
      })
      .catch(() => !cancelled && setError("Couldn't load this."))
    return () => {
      cancelled = true
    }
  }, [uploadId])

  async function generate() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/ai/${uploadId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { text?: string; at?: string; error?: string } | null
    setBusy(false)
    if (!response?.ok || !body?.text) return setError(body?.error ?? "That didn't work. Try again.")
    setDocs((current) => ({ ...current, [kind]: { text: body.text as string, at: body.at ?? new Date().toISOString() } }))
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!state) return <p className="p-4 text-sm text-neutral-400">{error ?? "Loading…"}</p>
  if (!state.enabled) {
    return (
      <div className={`rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 ${className ?? ""}`}>
        <p className="flex items-center gap-2 font-semibold text-neutral-900">
          <SparkleIcon size={16} weight="fill" /> Write it up with AI
        </p>
        <p className="mt-2">Turn any video into a doc, an SOP, a bug report, meeting notes, action items or a message to send. This is part of the paid plans.</p>
        <a href="/settings" className="mt-3 inline-block font-semibold text-red-600 hover:underline">
          See plans
        </a>
      </div>
    )
  }

  const current = docs[kind]
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white ${className ?? ""}`}>
      <div className="flex flex-wrap gap-1.5 border-b border-neutral-200 p-3">
        {KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => setKind(item.kind)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${kind === item.kind ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {current ? (
          <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap text-neutral-800">{current.text}</pre>
        ) : (
          <p className="text-sm text-neutral-500">
            {state.hasTranscript ? "Nothing written yet. Press Write to make one from what was said." : "This needs a transcript, and this video doesn't have one yet."}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-200 p-3">
        <button
          type="button"
          disabled={busy || !state.hasTranscript}
          onClick={() => void generate()}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? "Writing…" : current ? "Write again" : "Write"}
        </button>
        {current && (
          <button type="button" onClick={() => void copy(current.text)} className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-neutral-950">
            <CopyIcon size={16} /> {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  )
}
