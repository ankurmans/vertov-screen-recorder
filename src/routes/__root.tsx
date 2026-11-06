import { AppDialogHost } from "@/components/app-dialog"
import { CommandPalette } from "@/components/command-palette"
import { ConsentBanner } from "@/components/consent-banner"
import { Toasty } from "@cloudflare/kumo"
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { analyticsConfig } from "@/lib/analytics-config.server"
import { analyticsScript } from "@/lib/posthog"
import appCss from "../styles.css?url"
import { APP_NAME, ogImageMeta } from "@/lib/brand"

const loadAnalytics = createServerFn({ method: "GET" }).handler(() => analyticsConfig())

export const Route = createRootRoute({
  loader: async () => ({ analytics: await loadAnalytics() }),
  // The config never changes while the app is open.
  staleTime: Infinity,
  head: ({ loaderData }) => ({
    scripts: loaderData?.analytics ? [{ children: analyticsScript(loaderData.analytics) }] : [],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Record your screen and share it with a link.",
      },
      // Default preview for pages that do not set their own; a page's own og:image wins.
      ...ogImageMeta(),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg?v=kino-eye", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Toasty>{children}<CommandPalette /><AppDialogHost /><AnalyticsConsent /></Toasty>
        <Scripts />
      </body>
    </html>
  )
}

function AnalyticsConsent() {
  const data = Route.useLoaderData() as { analytics: unknown } | undefined
  return data?.analytics ? <ConsentBanner /> : null
}
