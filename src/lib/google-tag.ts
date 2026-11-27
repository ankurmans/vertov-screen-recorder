/**
 * Google Tag Manager container, loaded only after a visitor presses "Allow" on the cookie choice (the same choice that
 * lets PostHog set cookies), never in embeds, and not at all when the browser sends Global Privacy Control.
 */
export const GOOGLE_TAG_ID = "GTM-W8QC4SWD"

declare global {
  interface Window {
    dataLayer?: unknown[]
  }
}

export function loadGoogleTag() {
  if (typeof document === "undefined" || location.pathname.startsWith("/embed/")) return
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return
  if (document.querySelector(`script[src*="googletagmanager.com/gtm.js?id=${GOOGLE_TAG_ID}"]`)) return
  const layer = (window.dataLayer = window.dataLayer ?? [])
  layer.push({ "gtm.start": Date.now(), event: "gtm.js" })
  const script = document.createElement("script")
  script.async = true
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GOOGLE_TAG_ID}`
  document.head.appendChild(script)
}
