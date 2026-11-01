import { EnvelopeSimpleIcon, LockSimpleIcon, TimerIcon, TrashIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { APP_NAME } from "@/lib/brand"

/** Shown instead of the video when the link has a password, has expired, is members-only or was removed. */
export function LockedShare({ id, reason }: { id: string; reason: "locked" | "expired" | "members" | "removed" | "email" }) {
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function unlock(event: React.FormEvent) {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/unlock/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null)
    if (response?.ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setError(response?.status === 429 ? "Too many tries. Wait a minute and try again." : "That password isn't right.")
  }

  async function giveEmail(event: React.FormEvent) {
    event.preventDefault()
    if (!email || busy) return
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/email-gate/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    if (response?.ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setError("Enter a valid email address.")
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-900 text-white">
          {reason === "email" ? (
            <EnvelopeSimpleIcon size={22} />
          ) : reason === "expired" ? (
            <TimerIcon size={22} />
          ) : reason === "members" ? (
            <UsersThreeIcon size={22} />
          ) : reason === "removed" ? (
            <TrashIcon size={22} />
          ) : (
            <LockSimpleIcon size={22} />
          )}
        </div>
        {reason === "email" ? (
          <form onSubmit={(event) => void giveEmail(event)}>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">Enter your email to watch</h1>
            <p className="mt-1 text-sm text-neutral-600">The person who shared this video asked who is watching.</p>
            <label htmlFor="viewer-email" className="mt-4 block text-sm font-medium text-neutral-700">
              Email
            </label>
            <input
              id="viewer-email"
              type="email"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={!email || busy}
              className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "One moment…" : "Watch video"}
            </button>
          </form>
        ) : reason === "members" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">Only workspace members can watch this</h1>
            <p className="mt-1 text-sm text-neutral-600">Sign in with the account you use for that workspace, or ask the person who sent it for access.</p>
            <a
              href={`/signin?redirect=${encodeURIComponent(`/${id}`)}`}
              className="mt-4 block w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-neutral-800"
            >
              Sign in
            </a>
          </>
        ) : reason === "removed" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">This video was removed</h1>
            <p className="mt-1 text-sm text-neutral-600">Nobody had watched it in a while, so it was cleared from the free plan. The person who recorded it can still restore it for a few weeks.</p>
          </>
        ) : reason === "expired" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">This link has expired</h1>
            <p className="mt-1 text-sm text-neutral-600">Ask the person who sent it for a fresh link.</p>
          </>
        ) : (
          <form onSubmit={(event) => void unlock(event)}>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">This video is password protected</h1>
            <label htmlFor="video-password" className="mt-4 block text-sm font-medium text-neutral-700">
              Password
            </label>
            <input
              id="video-password"
              type="password"
              autoFocus
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={!password || busy}
              className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Watch video"}
            </button>
          </form>
        )}
        <p className="mt-6 text-xs text-neutral-500">
          Shared with <a href="/" className="font-medium text-neutral-700 hover:underline">{APP_NAME}</a>
        </p>
      </div>
    </main>
  )
}
