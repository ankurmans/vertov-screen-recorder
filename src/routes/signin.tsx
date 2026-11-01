import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"
import { enabledProviders, safeRedirectPath, ssoName } from "@/lib/auth.server"
import {
  sendMagicLink,
  signInWithGoogle,
  signInWithPasskey,
  signInWithSso,
  signUpWithPasskey,
} from "@/lib/auth-client"
import { Eye } from "@/components/eye"
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

  return (
    <main className="kino flex min-h-dvh items-center justify-center bg-zinc-50 px-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Eye size={56} tone="paper" className="mb-5" />
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">
          Sign in to {APP_NAME}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Record your screen and share it with a link.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(signInWithPasskey)}
            className="rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            Sign in with a passkey
          </button>
          {providers.includes("google") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => signInWithGoogle(redirect), () => {})}
              className="rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Continue with Google
            </button>
          )}
          {providers.includes("sso") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => signInWithSso(redirect), () => {})}
              className="rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Continue with {ssoLabel}
            </button>
          )}
        </div>

        {providers.includes("email") && (
          <form
            className="mt-6 flex flex-col gap-2 border-t border-neutral-200 pt-6 dark:border-neutral-800"
            onSubmit={(event) => {
              event.preventDefault()
              void run(
                () => sendMagicLink(email, redirect),
                () => setMessage(`Check ${email} for a sign-in link.`),
              )
            }}
          >
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Email me a sign-in link
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Send link
            </button>
          </form>
        )}

        <form
          className="mt-6 flex flex-col gap-2 border-t border-neutral-200 pt-6 dark:border-neutral-800"
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => signUpWithPasskey(name))
          }}
        >
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            New here? Create an account with a passkey
          </label>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            Create account
          </button>
        </form>

        {message && <p className="mt-4 text-sm text-green-600">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  )
}
