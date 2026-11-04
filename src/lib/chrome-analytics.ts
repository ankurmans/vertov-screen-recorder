/**
 * Events for the Chrome extension landing page. Two sinks, both existing: PostHog (consent-gated; cookieless until the
 * visitor accepts) and the anonymous daily counter behind `/api/tool-event`. A Web Store click is not an install, so it is
 * named `chrome_store_outbound_click`; the store reports installs, and `extension_authenticated` is what proves use.
 * Nothing about recordings, devices or the visitor is sent.
 */
export const CHROME_EVENTS = [
  "chrome_landing_view",
  "chrome_install_cta_click",
  "chrome_store_outbound_click",
  "extension_onboarding_started",
  "extension_authenticated",
] as const
export type ChromeEvent = (typeof CHROME_EVENTS)[number]

/** `ab_events.variant` value, in the same `tool:` namespace as the free tools so no migration is needed. */
export const CHROME_COUNTER_KEY = "tool:chrome-extension"

export function reportChromeEvent(event: ChromeEvent, placement?: string) {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    ;(window.posthog as unknown as { capture?: (name: string, props?: object) => void } | undefined)?.capture?.(event, { placement })
    if (nav.globalPrivacyControl === true || nav.doNotTrack === "1") return
    const body = JSON.stringify({ tool: "chrome-extension", event })
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/tool-event", new Blob([body], { type: "application/json" }))) return
    void fetch("/api/tool-event", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true })
  } catch {
    /* counting is best effort */
  }
}
