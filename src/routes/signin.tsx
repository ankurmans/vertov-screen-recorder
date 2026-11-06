import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { BuildingsIcon, EnvelopeSimpleIcon, FingerprintIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { enabledProviders, safeRedirectPath, ssoName } from "@/lib/auth.server"
import {
  linkEmail,
  sendMagicLink,
  signInWithGoogle,
  signInWithPasskey,
  signInWithPassword,
  signInWithSso,
  signUpWithPasskey,
} from "@/lib/auth-client"
import { Eye } from "@/components/eye"
import { GoogleIcon } from "@/components/google-icon"
import { APP_NAME } from "@/lib/brand"

const loadSignIn = createServerFn({ method: "GET" })
  .validator((redirect: string | undefined) => redirect)
  .handler(({ data }) => {
    const request = getRequest()
    return {
      providers: enabledProviders(new URL(request.url).origin),
      ssoLabel: ssoName() ?? "SSO",
      redirect: safeRedirectPath(data ?? null),
    }
  })

// What /api/account/email reports back after a confirmation link.
const LINKED = {
  added: "Email confirmed. Sign in with your passkey, Google or an email link.",
  merged: "That email already had an account, so your videos moved there. Sign in with Google or an email link.",
  expired: "That link has expired or was already used. Sign in, and send a new one from your library.",
} as const

export const Route = createFileRoute("/signin")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; email?: keyof typeof LINKED } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    email: search.email === "added" || search.email === "merged" || search.email === "expired" ? search.email : undefined,
  }),
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: ({ deps }) => loadSignIn({ data: deps.redirect }),
  head: () => ({ meta: [{ title: `Sign in — ${APP_NAME}` }] }),
  component: SignInPage,
})


function SignInPage() {
  const { providers, redirect, ssoLabel } = Route.useLoaderData()
  const { email: linked } = Route.useSearch()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(linked ? LINKED[linked] : null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Email links lead; the password form opens on request, or straight away where email links aren't set up.
  const [usePassword, setUsePassword] = useState(false)
  const passwordForm = !creating && (usePassword || !providers.includes("email"))

  async function run(action: () => Promise<void>, done?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (done) done()
      else window.location.href = redirect
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  const button = "flex items-center justify-center gap-2.5 px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50"
  const outline = `${button} border border-zinc-400 bg-white text-zinc-900 hover:border-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-400 dark:hover:bg-zinc-800`
  const solid = `${button} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white`
  const input = "border border-zinc-400 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-950 dark:text-white dark:focus:border-zinc-300"

  const link = "font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
  const divider = "mt-6 flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800"

  function switchMode(next: boolean) {
    setCreating(next)
    setError(null)
    setMessage(null)
  }

  return (
    <main className="kino flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-sm border border-zinc-300 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Eye size={56} tone="paper" className="mb-5" />
        <h1 className="text-2xl">{creating ? `Create your ${APP_NAME} account` : `Sign in to ${APP_NAME}`}</h1>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          {creating ? "Free, and it takes a few seconds. Your videos stay yours." : "Welcome back. Your videos stay yours."}
        </p>

        <div className="mt-6 flex flex-col gap-2.5">
          {providers.includes("google") && (
            <button type="button" disabled={busy} onClick={() => run(() => signInWithGoogle(redirect), () => {})} className={outline}>
              <GoogleIcon /> Continue with Google
            </button>
          )}
          {!creating && (
            <button type="button" disabled={busy} onClick={() => run(signInWithPasskey)} className={outline}>
              <FingerprintIcon size={19} weight="bold" /> Sign in with a passkey
            </button>
          )}
          {providers.includes("sso") && (
            <button type="button" disabled={busy} onClick={() => run(() => signInWithSso(redirect), () => {})} className={outline}>
              <BuildingsIcon size={18} weight="bold" /> Continue with {ssoLabel}
            </button>
          )}
        </div>

        {creating && (
          <form
            className={divider}
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                await signUpWithPasskey(name)
                // The passkey account exists from here; the email is confirmed from the link we send.
                if (providers.includes("email")) await linkEmail(email)
              })
            }}
          >
            <label htmlFor="signin-name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Make an account with a passkey
            </label>
            <input
              id="signin-name"
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              className={input}
            />
            {providers.includes("email") && (
              <input
                id="signin-passkey-email"
                type="email"
                required
                autoComplete="email"
                aria-label="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                className={input}
              />
            )}
            {providers.includes("email") && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">We'll send a link to confirm it, so you can also sign in with Google or by email, and get back in if you lose the passkey.</p>
            )}
            <button type="submit" disabled={busy} className={outline}>
              <FingerprintIcon size={19} weight="bold" /> Create account
            </button>
          </form>
        )}

        {!creating && passwordForm && (
          <form
            className={divider}
            onSubmit={(event) => {
              event.preventDefault()
              void run(() => signInWithPassword(email, password))
            }}
          >
            <label htmlFor="signin-password-email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Sign in with a password
            </label>
            <input id="signin-password-email" type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className={input} />
            <input type="password" required autoComplete="current-password" aria-label="Password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className={input} />
            <button type="submit" disabled={busy} className={solid}>
              Sign in
            </button>
            {providers.includes("email") && (
              <button type="button" onClick={() => setUsePassword(false)} className={`${link} self-start text-sm`}>
                Email me a link instead
              </button>
            )}
          </form>
        )}

        {providers.includes("email") && !passwordForm && (
          <form
            className={divider}
            onSubmit={(event) => {
              event.preventDefault()
              void run(
                () => sendMagicLink(email, redirect),
                () => setMessage(`Check ${email} for a ${creating ? "link to finish creating your account" : "sign-in link"}.`),
              )
            }}
          >
            <label htmlFor="signin-email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {creating ? "Or sign up with a link by email" : "Get a sign-in link by email"}
            </label>
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className={input}
            />
            <button type="submit" disabled={busy} className={creating ? outline : solid}>
              <EnvelopeSimpleIcon size={18} weight="bold" /> Email me a link
            </button>
            {!creating && (
              <button type="button" onClick={() => setUsePassword(true)} className={`${link} self-start text-sm`}>
                Use a password instead
              </button>
            )}
          </form>
        )}

        <p className="mt-6 border-t border-zinc-200 pt-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {creating ? "Already have an account? " : "New here? "}
          <button type="button" onClick={() => switchMode(!creating)} className={link}>
            {creating ? "Sign in" : "Create an account"}
          </button>
        </p>

        {message && <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  )
}
