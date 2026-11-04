import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { BuildingsIcon, EnvelopeSimpleIcon, FingerprintIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { enabledProviders, safeRedirectPath, ssoName } from "@/lib/auth.server"
import {
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

export const Route = createFileRoute("/signin")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: ({ deps }) => loadSignIn({ data: deps.redirect }),
  head: () => ({ meta: [{ title: `Sign in — ${APP_NAME}` }] }),
  component: SignInPage,
})

function SignInPage() {
  const { providers, redirect, ssoLabel } = Route.useLoaderData()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <main className="kino flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-sm border border-zinc-300 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Eye size={56} tone="paper" className="mb-5" />
        <h1 className="text-2xl">Welcome to {APP_NAME}</h1>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in, or make a free account in a few seconds. Your videos stay yours.
        </p>

        <div className="mt-6 flex flex-col gap-2.5">
          {providers.includes("google") && (
            <button type="button" disabled={busy} onClick={() => run(() => signInWithGoogle(redirect), () => {})} className={outline}>
              <GoogleIcon /> Continue with Google
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => run(signInWithPasskey)} className={outline}>
            <FingerprintIcon size={19} weight="bold" /> Sign in with a passkey
          </button>
          {providers.includes("sso") && (
            <button type="button" disabled={busy} onClick={() => run(() => signInWithSso(redirect), () => {})} className={outline}>
              <BuildingsIcon size={18} weight="bold" /> Continue with {ssoLabel}
            </button>
          )}
        </div>

        {providers.includes("email") && (
          <form
            className="mt-6 flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800"
            onSubmit={(event) => {
              event.preventDefault()
              void run(
                () => sendMagicLink(email, redirect),
                () => setMessage(`Check ${email} for a sign-in link.`),
              )
            }}
          >
            <label htmlFor="signin-email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Or get a sign-in link by email
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
            <button type="submit" disabled={busy} className={solid}>
              <EnvelopeSimpleIcon size={18} weight="bold" /> Email me a link
            </button>
          </form>
        )}

        <form
          className="mt-6 flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800"
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => signUpWithPasskey(name))
          }}
        >
          <label htmlFor="signin-name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            New here? Make an account with a passkey
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
          <button type="submit" disabled={busy} className={outline}>
            <FingerprintIcon size={19} weight="bold" /> Create account
          </button>
        </form>

        <details className="mt-6 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Sign in with a password</summary>
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void run(() => signInWithPassword(email, password))
            }}
          >
            <p className="text-xs text-zinc-500">For accounts we set up with a password, such as app reviewers.</p>
            <input type="email" required autoComplete="username" aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className={input} />
            <input type="password" required autoComplete="current-password" aria-label="Password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className={input} />
            <button type="submit" disabled={busy} className={outline}>
              Sign in
            </button>
          </form>
        </details>

        {message && <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  )
}
