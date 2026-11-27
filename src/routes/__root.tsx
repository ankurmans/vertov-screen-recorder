import { Toasty } from "@cloudflare/kumo/components/toast"
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import appCss from "../styles.css?url"
import { AppDialogHost } from "@/components/app-dialog"
import { CommandPalette } from "@/components/command-palette"
import { AnalyticsIdentity } from "@/components/analytics-identity"
import { ConsentBanner } from "@/components/consent-banner"
import { analyticsConfig } from "@/lib/analytics-config.server"
import { analyticsScript } from "@/lib/posthog"
import { APP_NAME, ogImageMeta } from "@/lib/brand"
import { HOSTED_EDITION } from "@/lib/edition"
import { ThemeSync } from "@/components/theme-sync"
import { themeScript } from "@/lib/theme"
import { clientErrorScript } from "@/lib/client-errors"
import { I18nProvider } from "@/lib/i18n/react"
import { useRememberSavedLanguage } from "@/components/language-settings"
import { LANGUAGE_TAGS, followsAppLanguage, type AppLanguage } from "@/lib/i18n/languages"
import type { Catalog } from "@/lib/i18n/core"
import { languageForRequest } from "@/lib/i18n/language.server"
import { rememberRenderLanguage } from "@/lib/i18n/request-language"
import { getRequest } from "@tanstack/react-start/server"

type RootI18n = { language: AppLanguage; source: string; app: boolean; catalog: Catalog | null }
const ENGLISH_I18N: RootI18n = { language: "en", source: "default", app: false, catalog: null }

const loadRootData = createServerFn({ method: "GET" })
  .validator((pathname: string) => pathname)
  .handler(async ({ data: pathname }) => {
    const i18n: RootI18n = await languageForRequest(getRequest(), pathname)
    rememberRenderLanguage(i18n)
    return { analytics: analyticsConfig(), i18n }
  })

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The route writes all of its image tags, the default card included, because only it knows which picture applies. */
    writesShareImage?: boolean
  }
}

// Whether the root data last loaded in this browser was for an app page; client navigation between marketing and app pages reloads it.
let loadedForApp: boolean | null = null

export const Route = createRootRoute({
  loader: async ({ location }) => {
    if (location.pathname === "/design-lab/kino-eye") return { analytics: null, i18n: ENGLISH_I18N }
    const data = await loadRootData({ data: location.pathname })
    loadedForApp = data.i18n.app
    return data
  },
  // The config never changes while the app is open.
  staleTime: Infinity,
  // The language catalog only applies to app and share pages, so moving between them and marketing pages reloads it.
  shouldReload: ({ location }) => loadedForApp !== null && loadedForApp !== followsAppLanguage(location.pathname),
  head: ({ loaderData, matches }) => ({
    scripts: [{ children: themeScript }, { children: clientErrorScript }, ...(loaderData?.analytics ? [{ children: analyticsScript(loaderData.analytics) }] : [])],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      // Link previews of a self-hosted copy name Vertov.
      ...(HOSTED_EDITION ? [] : [{ property: "og:site_name", content: "Vertov" }]),
      {
        name: "description",
        content: "Record your screen and share it with a link.",
      },
      // Default preview for pages that do not set their own; a page's own og:image wins. Routes with a picture of their own write
      // these tags themselves, or the default's size, type and alt text would describe that picture. (A child's loader data isn't here yet.)
      ...(matches.some((match) => match.staticData.writesShareImage) ? [] : ogImageMeta()),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg?v=kino-eye", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { i18n } = Route.useLoaderData()
  useRememberSavedLanguage(i18n.source, i18n.language)
  return (
      <I18nProvider language={i18n.language} catalog={i18n.catalog}>
        <DocumentShell appLanguage={i18n.app ? LANGUAGE_TAGS[i18n.language] : null}>{children}</DocumentShell>
      </I18nProvider>
  )
}

function DocumentShell({ children, appLanguage }: { children: React.ReactNode; appLanguage: string | null }) {
  const languageTag = appLanguage ?? "en"
  return (
    <html lang={languageTag} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <Toasty>{children}<CommandPalette /><AppDialogHost /><AnalyticsConsent /><ThemeSync /></Toasty>
        <Scripts />
      </body>
    </html>
  )
}

function AnalyticsConsent() {
  const data = Route.useLoaderData()
  return data.analytics ? <><ConsentBanner /><AnalyticsIdentity /></> : null
}
