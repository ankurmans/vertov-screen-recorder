import { EnvelopeSimpleIcon, LinkSimpleIcon } from "@phosphor-icons/react"
import { useState } from "react"
import type { AuthProvider } from "@/lib/use-auth"
import { GoogleIcon } from "@/components/google-icon"
import { APP_NAME } from "@/lib/brand"
import { sendMagicLink, signInWithGoogle } from "@/lib/auth-client"

/**
 * Shown over a guest's own video page. The recording is saved, but its link works for nobody else until the guest
 * signs up; signing in moves the guest's videos to the new account (auth.server.ts `onLinkAccount`).
 */
export function ClaimGate({ id, title, providers }: { id: string; title: string | null; providers: Array<AuthProvider> }) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const back = `/${id}?claimed=1`

  async function google() {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle(back)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "Google sign-in isn't available.")
    }
  }

  async function emailLink(event: React.FormEvent) {
    event.preventDefault()
    if (!email || busy) return
    setBusy(true)
    setError(null)
    try {
      await sendMagicLink(email, back)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the link.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="claim-title" className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 text-neutral-900 shadow-xl">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <LinkSimpleIcon size={22} />
        </div>
        <h1 id="claim-title" className="mt-4 text-lg font-semibold">Create your account to get the link</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {title?.trim() ? `“${title.trim()}” is saved.` : "Your recording is saved."} The link starts working for other people once you have a free {APP_NAME} account.
        </p>
        {sent ? (
          <p role="status" className="mt-5 rounded-lg bg-neutral-100 p-3 text-sm text-neutral-700">
            Check {email} for a sign-in link. It brings you back here with your link ready.
          </p>
        ) : (
          <>
            {providers.includes("google") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void google()}
                className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-lg border border-neutral-400 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 hover:border-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                <GoogleIcon /> Continue with Google
              </button>
            )}
            {providers.includes("email") && (
              <form onSubmit={(event) => void emailLink(event)} className="mt-3">
                <label htmlFor="claim-email" className="block text-sm font-medium text-neutral-700">
                  Or use your email
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="claim-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-neutral-400 px-3 py-2 text-sm focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!email || busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
                  >
                    <EnvelopeSimpleIcon size={16} weight="bold" /> Send link
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <p className="mt-5 text-xs text-neutral-500">Free during early access. No card needed.</p>
      </div>
    </div>
  )
}
