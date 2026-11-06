/** Product name, picked 2026-11-01 (after Dziga Vertov and his "Kino-Eye"); change it here and in extension/brand.js. */
export const APP_NAME = "Vertov"

/** Chrome Web Store listing (live 2026-11-04, extension 0.4.1). The homepage extension section still offers the manual ZIP install beside it. */
export const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/vertov-screen-recorder/jdoejaekaomohdbefogghphmgadgepdm"

/** The one indexable page about the extension. */
export const CHROME_PAGE = "/screen-recorder/chrome"

/** Where people and app-directory reviewers reach us (support pages, plugin manifests, directory listings). */
export const SUPPORT_EMAIL = "support@vertov.app"

/**
 * Default social preview: 1200x630 PNG built from the shipped marketing tokens (public/landing/og-vertov.png).
 * Platforms cache previews by URL, so a changed image needs a new file name, not a new file at the same path.
 */
export const OG_IMAGE = {
  path: "/landing/og-vertov.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: `${APP_NAME}. Record your screen. Share the link.`,
}

/** Meta entries for the default preview; pass the request origin where a page can know it (previews on workers.dev). */
export function ogImageMeta(origin = "https://vertov.app") {
  const url = `${origin}${OG_IMAGE.path}`
  return [
    { property: "og:image", content: url },
    { property: "og:image:type", content: OG_IMAGE.type },
    { property: "og:image:width", content: String(OG_IMAGE.width) },
    { property: "og:image:height", content: String(OG_IMAGE.height) },
    { property: "og:image:alt", content: OG_IMAGE.alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: url },
    { name: "twitter:image:alt", content: OG_IMAGE.alt },
  ]
}
