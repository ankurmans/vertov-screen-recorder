import { useEffect, useState } from "react"

/** Owners and admins: send new videos, comments and requested videos to a Slack channel. */
export function SlackSettings() {
  const [state, setState] = useState<{ connected: boolean; masked: string | null } | null>(null)
  const [webhook, setWebhook] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    void fetch("/api/workspace/slack")
      .then((response) => (response.ok ? response.json<{ connected: boolean; masked: string | null }>() : null))
      .then((body) => body && setState(body))
      .catch(() => {})
  }, [])

  async function call(url: string, init: RequestInit, ok: string) {
    setBusy(true)
    setMessage(null)
    const response = await fetch(url, init).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { connected?: boolean; masked?: string | null; error?: string } | null
    setBusy(false)
    if (!response?.ok) return setMessage({ text: body?.error ?? "That didn't work.", error: true })
    if (body && "connected" in body) setState({ connected: Boolean(body.connected), masked: body.masked ?? null })
    setMessage({ text: ok })
  }

  if (!state) return null
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-neutral-900">Slack</h2>
      <p className="mt-1 text-sm text-neutral-500">Post a message in a Slack channel when a video is ready, someone comments, or a requested video arrives.</p>
      {state.connected ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono text-neutral-700">{state.masked}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void call("/api/workspace/slack/test", { method: "POST" }, "Sent. Check your channel.")}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Send a test
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void call("/api/workspace/slack", { method: "DELETE" }, "Disconnected.")}
            className="text-neutral-500 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void call(
              "/api/workspace/slack",
              { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ webhook }) },
              "Connected. Press Send a test to try it.",
            ).then(() => setWebhook(""))
          }}
        >
          <input
            required
            type="password"
            autoComplete="off"
            value={webhook}
            onChange={(event) => setWebhook(event.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Connect
          </button>
        </form>
      )}
      {message && <p className={`mt-3 text-sm ${message.error ? "text-red-600" : "text-green-600"}`}>{message.text}</p>}
    </section>
  )
}
