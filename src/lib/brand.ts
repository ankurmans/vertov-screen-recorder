/** Product name, picked 2026-11-01 (after Dziga Vertov and his "Kino-Eye"); change it here and in extension/brand.js. */
export const APP_NAME = "Vertov"

/** Chrome Web Store listing (live 2026-11-04, extension 0.4.1). The homepage extension section still offers the manual ZIP install beside it. */
export const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/vertov-screen-recorder/jdoejaekaomohdbefogghphmgadgepdm"

/** The published extension's id (the segment after the name in CHROME_STORE_URL). The connect page only hands the API key to this id on the hosted site. */
export const CHROME_EXTENSION_ID = "jdoejaekaomohdbefogghphmgadgepdm"

/** The one indexable page about the extension. */
export const CHROME_PAGE = "/screen-recorder/chrome"

/** Where people and app-directory reviewers reach us (support pages, plugin manifests, directory listings). */
/** One mailbox, hello@vertov.app, with an alias per purpose. Use the alias that matches the page so replies reach the right thread. */
export const CONTACT_EMAIL = "hello@vertov.app" // general: footer, support, docs
export const SALES_EMAIL = "sales@vertov.app" // pricing, Enterprise, larger libraries, company SSO
export const PRESS_EMAIL = "press@vertov.app" // newsroom and media kit
export const LEGAL_EMAIL = "legal@vertov.app" // privacy, terms, takedown requests
export const SECURITY_EMAIL = "security@vertov.app" // vulnerability reports, /.well-known/security.txt
export const INVEST_EMAIL = "invest@vertov.app" // investor enquiries

/**
 * Default social preview: 1200x630 PNGs in the Kino Eye theme, rendered from scripts/og/card.html (`npx tsx scripts/og/render.mjs`).
 * Platforms cache previews by URL, so a changed image needs a new file name, not a new file at the same path.
 */
export const OG_IMAGE = {
  path: "/landing/og-kino-en.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: `${APP_NAME}. Screen recording for humans and AI agents.`,
}

/** The card carrying the homepage hero title in one marketing language. */
export const ogImagePath = (locale: string = "en") => `/landing/og-kino-${locale}.png`

/** Meta entries for the default preview. The origin is the primary domain; localized pages pass their locale and alt text. */
export function ogImageMeta(origin = "https://vertov.app", locale = "en", alt: string = OG_IMAGE.alt) {
  const url = `${origin}${ogImagePath(locale)}`
  return [
    { property: "og:image", content: url },
    { property: "og:image:type", content: OG_IMAGE.type },
    { property: "og:image:width", content: String(OG_IMAGE.width) },
    { property: "og:image:height", content: String(OG_IMAGE.height) },
    { property: "og:image:alt", content: alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: url },
    { name: "twitter:image:alt", content: alt },
  ]
}
