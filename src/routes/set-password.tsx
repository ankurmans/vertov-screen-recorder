import { createFileRoute, redirect } from "@tanstack/react-router"
import { PoweredBy } from "@/components/powered-by"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"
import { Eye } from "@/components/eye"
import { getSessionUser, safeRedirectPath } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { PASSWORD_MIN } from "@/lib/set-password-rules"
import { translatorFromMatches, useT } from "@/lib/i18n/react"

const loadSetPassword = createServerFn({ method: "GET" })
  .validator((to: string | undefined) => to)
  .handler(async ({ data }) => {
    const user = await getSessionUser(getRequest())
    if (!user) return null
    return { to: safeRedirectPath(data ?? null), email: user.email ?? "" }
  })

/** Where an email link lands for someone creating or resetting a password: they are signed in, the mailbox is proven. */
export const Route = createFileRoute("/set-password")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ deps }) => {
    const data = await loadSetPassword({ data: deps.redirect })
    if (!data) throw redirect({ to: "/signin", search: { redirect: "/set-password" } })
    return data
  },
  head: ({ matches }) => ({ meta: [{ title: translatorFromMatches(matches)("auth.setPassword.metaTitle", { app: APP_NAME }) }, { name: "robots", content: "noindex" }] }),
  component: SetPasswordPage,
})

function SetPasswordPage() {
  const t = useT()
  const { to, email } = Route.useLoaderData()
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (password.length < PASSWORD_MIN) return setError(t("auth.setPassword.tooShort", { min: PASSWORD_MIN }))
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error ?? t("auth.setPassword.saveFailed"))
      window.location.href = to
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.somethingWrong"))
      setBusy(false)
    }
  }

  return (
    <main className="kino flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <form noValidate onSubmit={save} className="flex w-full max-w-sm flex-col gap-3 border border-zinc-300 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Eye size={56} tone="paper" className="mb-2" />
        <h1 className="text-2xl">{t("auth.setPassword.title")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {email ? t("auth.setPassword.introWithEmail", { email, min: PASSWORD_MIN }) : t("auth.setPassword.intro", { min: PASSWORD_MIN })}
        </p>
        <input type="email" value={email} autoComplete="username" readOnly hidden aria-hidden />
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            aria-label={t("auth.setPassword.newPassword")}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
            placeholder={t("auth.setPassword.newPassword")}
            className="w-full border border-zinc-400 bg-white px-3 py-2.5 pr-16 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-950 dark:text-white dark:focus:border-zinc-300"
          />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-xs font-medium text-zinc-600 underline dark:text-zinc-400">
            {show ? t("auth.setPassword.hide") : t("auth.setPassword.show")}
          </button>
        </div>
        {password.length > 0 && password.length < PASSWORD_MIN && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("auth.setPassword.moreNeeded", { count: PASSWORD_MIN - password.length })}</p>
        )}
        <button type="submit" disabled={busy} className="flex cursor-pointer items-center justify-center gap-2.5 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 active:translate-y-px disabled:cursor-wait disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:outline-zinc-100">
          {busy ? t("auth.setPassword.saving") : t("auth.setPassword.save")}
        </button>
        <a href={to} className="self-start text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100">{t("auth.setPassword.skip")}</a>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <PoweredBy className="mt-2" />
      </form>
    </main>
  )
}
