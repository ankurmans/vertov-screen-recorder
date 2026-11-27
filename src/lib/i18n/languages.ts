export const APP_LANGUAGES = ["en", "es", "fr", "de", "pt-br", "pt-pt"] as const
export type AppLanguage = (typeof APP_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: AppLanguage = "en"
export const LANGUAGE_COOKIE = "vertov_lang"

/** Each language in its own words, as the selector shows them. */
export const LANGUAGE_NAMES: Readonly<Record<AppLanguage, string>> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-br": "Português (Brasil)",
  "pt-pt": "Português (Portugal)",
}

/** BCP 47 tags for `<html lang>` and `Intl`. */
export const LANGUAGE_TAGS: Readonly<Record<AppLanguage, string>> = {
  en: "en",
  es: "es",
  fr: "fr",
  de: "de",
  "pt-br": "pt-BR",
  "pt-pt": "pt-PT",
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (APP_LANGUAGES as ReadonlyArray<string>).includes(value)
}

/** A supported language from one tag such as `pt-PT`, `pt_br` or `fr-CA`, or null. */
export function languageFromTag(tag: string): AppLanguage | null {
  const [primary = "", region = ""] = tag.trim().toLowerCase().replace(/_/g, "-").split("-")
  if (primary === "en" || primary === "es" || primary === "fr" || primary === "de") return primary
  if (primary !== "pt") return null
  // Brazil is the default Portuguese; Portugal and the African and Asian countries that follow European usage get pt-pt.
  return ["pt", "ao", "mz", "cv", "gw", "st", "tl", "mo", "gq"].includes(region) && region !== "" ? "pt-pt" : "pt-br"
}

/** The best supported language for an Accept-Language header (q-values respected), or null when none matches. */
export function matchAcceptLanguage(header: string | null | undefined): AppLanguage | null {
  if (!header) return null
  const choices = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";")
      const q = params.map((param) => /^\s*q=([\d.]+)\s*$/i.exec(param)?.[1]).find(Boolean)
      return { tag, q: q === undefined ? 1 : Number(q), index }
    })
    .filter((choice) => choice.tag && choice.tag !== "*" && Number.isFinite(choice.q) && choice.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  for (const choice of choices) {
    const language = languageFromTag(choice.tag)
    if (language) return language
  }
  return null
}

export function readLanguageCookie(cookieHeader: string | null | undefined): AppLanguage | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === LANGUAGE_COOKIE) {
      const value = decodeURIComponent(rest.join("=")).toLowerCase()
      return isAppLanguage(value) ? value : null
    }
  }
  return null
}

export function languageCookie(language: AppLanguage, secure: boolean): string {
  return `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure ? "; Secure" : ""}`
}

export type LanguageSources = {
  query?: string | null
  cookie?: string | null
  /** The signed-in user's saved language; looked up only when the first two are absent. */
  saved?: string | null
  acceptLanguage?: string | null
}

/** Explicit `?lang=`, then the cookie, then the saved choice, then the browser, then English. */
export function resolveLanguage(sources: LanguageSources): { language: AppLanguage; source: "query" | "cookie" | "saved" | "browser" | "default" } {
  const query = sources.query ? languageFromTag(sources.query) : null
  if (query && isAppLanguage(sources.query?.toLowerCase())) return { language: query, source: "query" }
  const cookie = readLanguageCookie(sources.cookie)
  if (cookie) return { language: cookie, source: "cookie" }
  if (isAppLanguage(sources.saved)) return { language: sources.saved, source: "saved" }
  const browser = matchAcceptLanguage(sources.acceptLanguage)
  if (browser) return { language: browser, source: "browser" }
  return { language: DEFAULT_LANGUAGE, source: "default" }
}

/**
 * Paths that follow the app language: the signed-in app, sign-in, share, embed, join, request and connect pages.
 * Marketing pages keep their own language (English, or the locale prefix), so cached marketing HTML never carries a user's choice.
 */
const APP_LANGUAGE_PATH = /^\/(home|settings|playlists|analytics|tutorials|record|import|app|signin|set-password|join|request|connect-extension|p|embed|oauth)(\/|$)/
// Share links are 8 hex characters (the first block of a UUID).
const SHARE_PATH = /^\/[0-9a-f]{8}$/
export function followsAppLanguage(pathname: string): boolean {
  if (APP_LANGUAGE_PATH.test(pathname)) return true
  return SHARE_PATH.test(pathname)
}
