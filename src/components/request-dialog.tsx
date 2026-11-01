import { CheckIcon, CopyIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

interface RequestRow {
  id: string
  title: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  responses: number
}

/** Make a link that lets anyone record a video into this workspace, and see how each one is doing. */
export function RequestDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Array<RequestRow>>([])
  const [copied, setCopied] = useState<string | null>(null)

  const load = () =>
    fetch("/api/requests")
      .then((r) => r.json() as Promise<{ requests: Array<RequestRow> }>)
      .then((body) => setRows(body.requests))
      .catch(() => {})
  useEffect(() => void load(), [])

  const link = (id: string) => `${location.origin}/request/${id}`
  async function copy(id: string) {
    await navigator.clipboard.writeText(link(id)).catch(() => {})
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  async function create() {
    setBusy(true)
    setError(null)
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, message: message || null }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { id?: string; error?: string } | null
    setBusy(false)
    if (!response?.ok || !body?.id) return setError(body?.error ?? "Couldn't make the link.")
    setTitle("")
    setMessage("")
    await copy(body.id)
    void load()
  }

  async function revoke(id: string) {
    await fetch(`/api/requests/${id}`, { method: "DELETE" }).catch(() => {})
    void load()
  }

  const closed = (row: RequestRow) => Boolean(row.revokedAt) || Date.parse(row.expiresAt) <= Date.now()

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-label="Request a video" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Request a video</h2>
            <p className="mt-1 text-sm text-neutral-500">Send the link to anyone. They record in their browser with no account, and the video lands in your library.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-neutral-700">
            <XIcon size={20} />
          </button>
        </div>

        <form
          className="mt-5 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="What should they record? e.g. Your feedback on the new onboarding"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Optional: tips or questions to answer"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
            Create link and copy it
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        {rows.length > 0 && (
          <ul className="mt-6 divide-y divide-neutral-200 border-t border-neutral-200">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-900">{row.title}</p>
                  <p className="text-neutral-500">
                    {row.responses} {row.responses === 1 ? "video" : "videos"} received{closed(row) ? " · closed" : ""}
                  </p>
                </div>
                {!closed(row) && (
                  <>
                    <button type="button" onClick={() => void copy(row.id)} className="flex items-center gap-1 text-neutral-700 hover:text-neutral-950">
                      {copied === row.id ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {copied === row.id ? "Copied" : "Copy link"}
                    </button>
                    <button type="button" onClick={() => void revoke(row.id)} className="text-neutral-500 hover:text-red-600">
                      Close
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
