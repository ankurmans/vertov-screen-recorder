import { useEffect, useState } from "react"
import { authClient, linkEmail, signInWithGoogle } from "@/lib/auth-client"

/**
 * Visitors who pressed "Start recording" are signed in as guests. This asks them to attach a passkey so the
 * videos stay theirs on other devices; it disappears once one exists.
 */
export function SaveAccountBanner({ google = false }: { google?: boolean }) {
  const { data } = authClient.useSession()
  const guest = Boolean((data?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous)
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!guest) return
    void authClient.passkey.listUserPasskeys().then((res) => setHasPasskey((res.data?.length ?? 0) > 0)).catch(() => setHasPasskey(false))
  }, [guest])

  if (guest && hasPasskey) return <AddEmailBanner />
  if (!guest || hasPasskey !== false) return null

  async function save() {
    setBusy(true)
    setError(null)
    const res = await authClient.passkey.addPasskey({ name: "My videos" }).catch(() => null)
    setBusy(false)
    if (!res || res.error) setError(res?.error?.message ?? "The passkey wasn't saved. Try again.")
    else setHasPasskey(true)
  }

  async function withGoogle() {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle("/home")
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "Google sign-in isn't available.")
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      <span className="min-w-0 flex-1">
        You're using a guest account on this browser. Save it with a passkey so your videos follow you to other devices.
      </span>
      {error && <span className="text-red-700">{error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="rounded-lg bg-amber-900 px-3 py-1.5 font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
      >
        Save my account
      </button>
      {google && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void withGoogle()}
          className="rounded-lg border border-amber-900/30 bg-white px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
        >
          Continue with Google
        </button>
      )}
    </div>
  )
}

/** A passkey account with no email yet: one link and it can use Google, email links, and recovery. */
function AddEmailBanner() {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await linkEmail(email)
      setSent(email)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the link.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void send(event)} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      <span className="min-w-0 flex-1">
        {sent
          ? `Check ${sent} and open the link to confirm it.`
          : "Add your email so you can sign in with Google or by email too, and get back in if you lose your passkey."}
      </span>
      {error && <span className="text-red-700">{error}</span>}
      {!sent && (
        <>
          <input
            type="email"
            required
            autoComplete="email"
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="w-56 rounded-lg border border-amber-900/30 bg-white px-3 py-1.5 text-amber-950"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-amber-900 px-3 py-1.5 font-semibold text-white hover:bg-amber-800 disabled:opacity-50">
            Send link
          </button>
        </>
      )}
    </form>
  )
}
