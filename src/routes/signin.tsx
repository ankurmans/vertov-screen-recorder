import { createFileRoute } from "@tanstack/react-router"
import { PoweredBy } from "@/components/powered-by"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { BuildingsIcon, EnvelopeSimpleIcon, FingerprintIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import type { MessageKey } from "@/lib/i18n/en/index"
import type {Region} from "@/lib/region";
import { enabledProviders, safeRedirectPath, ssoName } from "@/lib/auth.server"
import {
  linkEmail,
  sendMagicLink,
  sendPasswordLink,
  signInWithGoogle,
  signInWithPasskey,
  signInWithPassword,
  signInWithSso,
  signUpWithPasskey,
} from "@/lib/auth-client"
import { BrandMark } from "@/components/brand-mark"
import { GoogleIcon } from "@/components/google-icon"
import { APP_NAME } from "@/lib/brand"
import { HOSTED_EDITION } from "@/lib/edition"
import { REGIONS,  otherRegion, signInUrl, suggestRegion } from "@/lib/region"
import { currentRegion, regionChoiceOn } from "@/lib/region.server"
import { LanguageSelect } from "@/components/language-settings"
import { translatorFromMatches, useT } from "@/lib/i18n/react"

const loadSignIn = createServerFn({ method: "GET" })
  .validator((redirect: string | undefined) => redirect)
  .handler(({ data }) => {
    const request = getRequest()
    const region = currentRegion()
    return {
      providers: enabledProviders(new URL(request.url).origin),
      ssoLabel: ssoName() ?? "SSO",
      redirect: safeRedirectPath(data ?? null),
      // Where this stack is, whether sign-up asks, and where Cloudflare says the visitor is (a default, never a decision).
      region,
      choice: regionChoiceOn(),
      suggested: suggestRegion(request.headers.get("cf-ipcountry")),
    }
  })

type SentKind = "signin" | "signup" | "password" | "reset"

const SENT_HELP = {
  signin: "auth.signin.sent.helpSignin",
  signup: "auth.signin.sent.helpSignup",
  password: "auth.signin.sent.helpPassword",
  reset: "auth.signin.sent.helpReset",
} as const satisfies Record<SentKind, MessageKey>

// What /api/account/email reports back after a confirmation link.
const LINKED = {
  added: "auth.signin.linked.added",
  merged: "auth.signin.linked.merged",
  expired: "auth.signin.linked.expired",
} as const satisfies Record<string, MessageKey>

const REGION_LABEL = {
  us: "auth.signin.region.us",
  eu: "auth.signin.region.eu",
} as const satisfies Record<Region, MessageKey>

export const Route = createFileRoute("/signin")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; email?: keyof typeof LINKED; create?: 1; here?: 1 } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    create: search.create === 1 || search.create === "1" || search.create === true ? 1 : undefined,
    here: search.here === 1 || search.here === "1" ? 1 : undefined,
    email: search.email === "added" || search.email === "merged" || search.email === "expired" ? search.email : undefined,
  }),
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: ({ deps }) => loadSignIn({ data: deps.redirect }),
  // A utility page with one URL per ?redirect= value: noindex (follow), and the clean address as canonical.
  head: ({ matches }) => {
    const t = translatorFromMatches(matches)
    return {
      meta: [{ title: t("auth.signin.metaTitle", { app: APP_NAME }) }, { name: "robots", content: "noindex, follow" }],
      links: HOSTED_EDITION ? [{ rel: "canonical", href: "https://vertov.app/signin" }] : [],
    }
  },
  component: SignInPage,
})


type Method = "email" | "passkey" | "google" | "sso" | "password"
const LAST_USED_KEY = "vertov:last-signin"
const METHODS: ReadonlyArray<Method> = ["email", "passkey", "google", "sso", "password"]

/** The method this browser signed in with last, for the small "Last used" tag. Per browser, never sent anywhere. */
function readLastUsed(): Method | null {
  try {
    const value = window.localStorage.getItem(LAST_USED_KEY)
    return METHODS.find((method) => method === value) ?? null
  } catch {
    return null
  }
}

function rememberMethod(method: Method) {
  try {
    window.localStorage.setItem(LAST_USED_KEY, method)
  } catch {
    // Storage is blocked: the tag simply doesn't show next time.
  }
}

function LastUsed() {
  const t = useT()
  return <span className="absolute end-2 top-0 -translate-y-1/2 whitespace-nowrap rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium leading-none text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">{t("auth.signin.lastUsed")}</span>
}

function SignInPage() {
  const t = useT()
  const { providers, redirect, ssoLabel, region, choice: regionChoice, suggested } = Route.useLoaderData()
  const { email: linked, create } = Route.useSearch()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(linked ? t(LINKED[linked]) : null)
  // Set once an email link has gone out: the screen then shows only that confirmation, with a way to resend or change the address.
  const [sent, setSent] = useState<{ email: string; kind: SentKind } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(Boolean(create))
  // Read after mount so the server-rendered page and the first client render match.
  const [lastUsed, setLastUsed] = useState<Method | null>(null)
  useEffect(() => setLastUsed(readLastUsed()), [])
  // Only the US host applies the location default; someone who opened eu.vertov.app chose it.
  const [where, setWhere] = useState<Region>(region === "eu" ? "eu" : suggested)
  const elsewhere = regionChoice && creating && where !== region
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
      setError(err instanceof Error ? err.message : t("auth.somethingWrong"))
    } finally {
      setBusy(false)
    }
  }

  const button = "relative flex items-center justify-center gap-2.5 px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50"
  const outline = `${button} border border-zinc-400 bg-white text-zinc-900 hover:border-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-400 dark:hover:bg-zinc-800`
  const solid = `${button} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white`
  const input = "border border-zinc-400 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-950 dark:text-white dark:focus:border-zinc-300"

  const link = "font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
  const divider = "mt-6 flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800"

  function resend() {
    if (!sent) return
    const { email: to, kind } = sent
    void run(() => (kind === "password" || kind === "reset" ? sendPasswordLink(to, redirect) : sendMagicLink(to, redirect)), () => setMessage(t("auth.signin.sent.sentAgain", { email: to })))
  }

  function switchMode(next: boolean) {
    setCreating(next)
    setError(null)
    setMessage(null)
  }

  const emailLabel = (text: string, id: string) => (
    <label htmlFor={id} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
      {text}
    </label>
  )

  const createForm = providers.includes("email") && (
    <form
      className={divider}
      onSubmit={(event) => {
        event.preventDefault()
        void run(
          () => sendMagicLink(email, redirect),
          () => setSent({ email, kind: "signup" }),
        )
      }}
    >
      {emailLabel(t("auth.signin.signUpEmailLabel"), "signin-email")}
      <input id="signin-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className={input} />
      <button type="submit" disabled={busy} className={solid}>
        <EnvelopeSimpleIcon size={18} weight="bold" /> {t("auth.signin.emailMeLink")}
      </button>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <button
          type="button"
          disabled={busy}
          className={link}
          onClick={() => {
            if (!email) return setError(t("auth.signin.enterEmailFirst"))
            void run(() => sendPasswordLink(email, redirect), () => setSent({ email, kind: "password" }))
          }}
        >
          {t("auth.signin.choosePasswordInstead")}
        </button>
        <button
          type="button"
          disabled={busy}
          className={link}
          onClick={() => {
            if (!email) return setError(t("auth.signin.enterEmailFirst"))
            void run(async () => {
              await signUpWithPasskey()
              await linkEmail(email)
            })
          }}
        >
          {t("auth.signin.usePasskeyInstead")}
        </button>
      </p>
    </form>
  )

  const passwordFormEl = (
    <form
      className="mt-6 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void run(() => signInWithPassword(email, password), () => { rememberMethod("password"); window.location.href = redirect })
      }}
    >
      {emailLabel(t("auth.signin.passwordLabel"), "signin-password-email")}
      <input id="signin-password-email" type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className={input} />
      <input type="password" required autoComplete="current-password" aria-label={t("auth.signin.password")} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("auth.signin.password")} className={input} />
      <button type="submit" disabled={busy} className={solid}>
        {t("auth.signin.submit")} {lastUsed === "password" && <LastUsed />}
      </button>
      {providers.includes("email") && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button type="button" onClick={() => setUsePassword(false)} className={link}>
            {t("auth.signin.emailLinkInstead")}
          </button>
          <button
            type="button"
            disabled={busy}
            className={link}
            onClick={() => {
              if (!email) return setError(t("auth.signin.enterEmailFirst"))
              void run(() => sendPasswordLink(email, redirect), () => setSent({ email, kind: "reset" }))
            }}
          >
            {t("auth.signin.forgotPassword")}
          </button>
        </p>
      )}
    </form>
  )

  const linkForm = providers.includes("email") && (
    <form
      className="mt-6 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void run(
          () => sendMagicLink(email, redirect),
          () => { rememberMethod("email"); setSent({ email, kind: "signin" }) },
        )
      }}
    >
      <label htmlFor="signin-email" className="sr-only">
        {t("auth.signin.emailAddress")}
      </label>
      <input id="signin-email" type="email" required autoComplete="email webauthn" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className={input} />
      <button type="submit" disabled={busy} className={solid}>
        {t("auth.signin.emailMeSignInLink")} {lastUsed === "email" && <LastUsed />}
      </button>
    </form>
  )

  return (
    <main className="kino flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-sm border border-zinc-300 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandMark size={32} />
          <span className="text-[30px] font-semibold leading-none tracking-tight">{APP_NAME}</span>
        </div>
        {sent ? (
          <div role="status" className="flex flex-col gap-3">
            <EnvelopeSimpleIcon size={32} weight="bold" />
            <h1 className="text-2xl">{t("auth.signin.sent.title")}</h1>
            <p className="text-base text-zinc-800 dark:text-zinc-200">
              {t.rich("auth.signin.sent.to", { email: sent.email }, { strong: (c) => <strong className="break-all font-semibold">{c}</strong> })}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t(SENT_HELP[sent.kind])}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <button type="button" disabled={busy} onClick={resend} className={link}>{t("auth.signin.sent.again")}</button>
              <button type="button" onClick={() => { setSent(null); setMessage(null); setError(null) }} className={link}>{t("auth.signin.sent.differentEmail")}</button>
            </p>
            {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          </div>
        ) : (
        <>
        <h1 className="text-center text-2xl">{creating ? t("auth.signin.createTitle", { app: APP_NAME }) : t("auth.signin.title")}</h1>
        {creating && <p className="mt-1.5 text-center text-sm text-zinc-600 dark:text-zinc-400">{t("auth.signin.createSubtitle")}</p>}
        {regionChoice && !creating && region === "us" && suggested === "eu" && (
          <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {t.rich("auth.signin.newInEurope", { host: REGIONS.eu.host }, {
              link: (c) => <a href={signInUrl("eu", redirect, true)} className={link}>{c}</a>,
            })}
          </p>
        )}

        {regionChoice && creating && (
          <fieldset className="mt-6 flex flex-col gap-2 border border-zinc-300 p-3 dark:border-zinc-700">
            <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("auth.signin.dataLocation")}</legend>
            {(["us", "eu"] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                <input type="radio" name="data-location" value={option} checked={where === option} onChange={() => setWhere(option)} />
                {t(REGION_LABEL[option])}
              </label>
            ))}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("auth.signin.dataLocationNote")}
            </p>
          </fieldset>
        )}
        {elsewhere && (
          <div className={divider}>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{t("auth.signin.createOn", { host: REGIONS[where].host })}</p>
            <a href={signInUrl(where, redirect, true)} className={solid}>
              {t("auth.signin.continueOn", { host: REGIONS[where].host })}
            </a>
          </div>
        )}
        <div hidden={elsewhere}>
        {!creating && (passwordForm ? passwordFormEl : linkForm)}

        {!creating && (providers.includes("email") || passwordForm) && (
          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            {t("auth.signin.orSignInWith")}
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
        )}

        <div className={`${creating || !(providers.includes("email") || passwordForm) ? "mt-6 " : ""}flex flex-col gap-2.5`}>
          {providers.includes("google") && (
            <button type="button" disabled={busy} onClick={() => { rememberMethod("google"); void run(() => signInWithGoogle(redirect), () => {}) }} className={outline}>
              <GoogleIcon /> {creating ? t("auth.signin.continueWithGoogle") : t("auth.signin.google")} {!creating && lastUsed === "google" && <LastUsed />}
            </button>
          )}
          {!creating && (
            <button type="button" disabled={busy} onClick={() => run(signInWithPasskey, () => { rememberMethod("passkey"); window.location.href = redirect })} className={outline}>
              <FingerprintIcon size={19} weight="bold" /> {t("auth.signin.passkey")} {lastUsed === "passkey" && <LastUsed />}
            </button>
          )}
          {providers.includes("sso") && (
            <button type="button" disabled={busy} onClick={() => { rememberMethod("sso"); void run(() => signInWithSso(redirect), () => {}) }} className={outline}>
              <BuildingsIcon size={18} weight="bold" /> {creating ? t("auth.signin.continueWithSso", { sso: ssoLabel }) : ssoLabel === "SSO" ? t("auth.signin.companySso") : ssoLabel} {!creating && lastUsed === "sso" && <LastUsed />}
            </button>
          )}
          {HOSTED_EDITION && !creating && !providers.includes("sso") && (
            // Single sign-on is set up per company, so without it configured the button starts a conversation.
            <a href="/enterprise?topic=sso" className={outline}>
              <BuildingsIcon size={18} weight="bold" /> {t("auth.signin.companySso")}
            </a>
          )}
        </div>

        {creating && createForm}

        {!creating && providers.includes("email") && !passwordForm && (
          <button type="button" onClick={() => setUsePassword(true)} className={`${link} mt-5 block w-full text-center text-sm`}>
            {t("auth.signin.usePasswordInstead")}
          </button>
        )}
        </div>

        {/* The terms are the hosted service's. A self-hosted copy has none to agree to. */}
        {HOSTED_EDITION && (
          <p className="mt-5 text-center text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t.rich("auth.signin.agreeTerms", undefined, {
              terms: (c) => <a href="/terms" className="underline underline-offset-2">{c}</a>,
              privacy: (c) => <a href="/privacy" className="underline underline-offset-2">{c}</a>,
            })}
          </p>
        )}

        <p className="mt-4 border-t border-zinc-200 pt-4 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <button type="button" onClick={() => switchMode(!creating)} className={link}>
            {creating ? t("auth.signin.haveAccount") : t("auth.signin.createAccount")}
          </button>
        </p>

        {regionChoice && !creating && (
          <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {t.rich("auth.signin.otherRegion", { region: t(REGION_LABEL[otherRegion(region)]), host: REGIONS[otherRegion(region)].host }, {
              link: (c) => <a href={signInUrl(otherRegion(region), redirect, false, region === "eu")} className={`${link} mx-auto mt-1 block w-fit`}>{c}</a>,
            })}
          </p>
        )}

        {message && <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        </>
        )}
        <div className="mt-5 flex justify-center">
          <LanguageSelect signedIn={false} compact />
        </div>
        <PoweredBy className="mt-4" />
      </div>
    </main>
  )
}
