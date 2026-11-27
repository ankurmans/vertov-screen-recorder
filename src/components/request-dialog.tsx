import { CheckIcon, CopyIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n/react"
import { KEPT_OPEN_LIMIT, isKeptOpen, requestMarkdown } from "@/lib/request-link"

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
  const t = useT()
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [keepOpen, setKeepOpen] = useState(false)
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
  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  async function create() {
    setBusy(true)
    setError(null)
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, message: message || null, keepOpen }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { id?: string; error?: string } | null
    setBusy(false)
    if (!response?.ok || !body?.id) return setError(body?.error ?? t("library.request.failed"))
    setTitle("")
    setMessage("")
    setKeepOpen(false)
    await copy(body.id, link(body.id))
    void load()
  }

  async function revoke(id: string) {
    await fetch(`/api/requests/${id}`, { method: "DELETE" }).catch(() => {})
    void load()
  }

  const closed = (row: RequestRow) =>
    Boolean(row.revokedAt) || Date.parse(row.expiresAt) <= Date.now() || (isKeptOpen(row.expiresAt) && row.responses >= KEPT_OPEN_LIMIT)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-label={t("library.actions.requestVideo")} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{t("library.actions.requestVideo")}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t("library.request.intro")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="text-neutral-400 hover:text-neutral-700">
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
            placeholder={t("library.request.titlePlaceholder")}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t("library.request.messagePlaceholder")}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={keepOpen} onChange={(event) => setKeepOpen(event.target.checked)} className="mt-0.5" />
            <span>
              {t("library.request.keepOpen")}
              <span className="block text-xs text-neutral-500">{t("library.request.keepOpenHint", { limit: KEPT_OPEN_LIMIT })}</span>
            </span>
          </label>
          <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
            {t("library.request.submit")}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        {rows.length > 0 && (
          <ul className="mt-6 divide-y divide-neutral-200 border-t border-neutral-200">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-900">{row.title}</p>
                  <p className="text-neutral-500">
                    {closed(row) ? t("library.request.receivedClosed", { count: row.responses }) : t("library.request.received", { count: row.responses })}
                    {!closed(row) && isKeptOpen(row.expiresAt) && ` · ${t("library.request.staysOpen", { limit: KEPT_OPEN_LIMIT })}`}
                  </p>
                </div>
                {!closed(row) && (
                  <>
                    <button type="button" onClick={() => void copy(row.id, link(row.id))} className="flex items-center gap-1 text-neutral-700 hover:text-neutral-950">
                      {copied === row.id ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {copied === row.id ? t("common.copied") : t("library.actions.copyLink")}
                    </button>
                    {isKeptOpen(row.expiresAt) && (
                      <button type="button" onClick={() => void copy(`md:${row.id}`, requestMarkdown(t("library.request.markdownLabel", { title: row.title }), link(row.id)))} className="text-neutral-500 hover:text-neutral-950">
                        {copied === `md:${row.id}` ? t("common.copied") : t("library.request.copyMarkdown")}
                      </button>
                    )}
                  </>
                )}
                {/* A full kept-open link can still be closed: deleting one of its videos would otherwise reopen it. */}
                {(!closed(row) || (isKeptOpen(row.expiresAt) && !row.revokedAt)) && (
                  <button type="button" onClick={() => void revoke(row.id)} className="text-neutral-500 hover:text-red-600">
                    {t("common.close")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
