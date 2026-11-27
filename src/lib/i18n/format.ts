import { formatTimeAgo, formatViews } from "../format.ts"
import { LANGUAGE_TAGS, type AppLanguage } from "./languages.ts"
import type { AppTranslator } from "./react.tsx"

/**
 * Relative time in the app language. English keeps the exact strings the app always showed; other languages use `Intl`.
 * `reference` is the server snapshot used while React hydrates, so server and browser agree on "5 min ago".
 */
export function localizedTimeAgo(dateString: string, language: AppLanguage, t: AppTranslator, reference?: { now: number; locale: string; timeZone: string }): string {
  if (language === "en") return formatTimeAgo(dateString, reference)
  const tag = LANGUAGE_TAGS[language]
  const date = new Date(`${dateString.replace(" ", "T")}Z`)
  const seconds = Math.floor(((reference?.now ?? Date.now()) - date.getTime()) / 1000)
  if (seconds < 60) return t("common.justNow")
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" })
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), "minute")
  if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), "hour")
  if (seconds < 2592000) return relative.format(-Math.floor(seconds / 86400), "day")
  return date.toLocaleDateString(reference?.locale ?? tag, reference ? { timeZone: reference.timeZone } : undefined)
}

/** "1 view", "999 views", "1.2k views" in English; plural forms and compact numbers elsewhere. */
export function localizedViews(views: number, language: AppLanguage, t: AppTranslator): string {
  if (language === "en") return formatViews(views)
  if (views < 1000) return t("common.views", { count: views })
  const compact = new Intl.NumberFormat(LANGUAGE_TAGS[language], { notation: "compact", maximumFractionDigits: 1 }).format(views)
  return t("common.viewsCompact", { count: compact })
}

const unitNumber = (language: AppLanguage, value: number, unit: "minute" | "hour", unitDisplay: "long" | "narrow") =>
  new Intl.NumberFormat(LANGUAGE_TAGS[language], { style: "unit", unit, unitDisplay, maximumFractionDigits: 1 }).format(value)

/** A library size: minutes up to five hours ("180 minutes"), whole hours above. English matches `formatBank` in plans.ts exactly. */
export function localizedBank(hours: number, language: AppLanguage): string {
  if (language === "en") {
    if (hours <= 5) {
      const minutes = Math.round(hours * 60)
      return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
    }
    return `${Math.round(hours).toLocaleString("en-US")} hours`
  }
  return hours <= 5 ? unitNumber(language, Math.round(hours * 60), "minute", "long") : unitNumber(language, Math.round(hours), "hour", "long")
}

/** A short duration of stored video ("45 min", "2.5 h"). English matches `formatHours` in plans.ts exactly. */
export function localizedHours(hours: number, language: AppLanguage): string {
  if (language === "en") return hours < 1 ? `${Math.round(hours * 60)} min` : `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} h`
  return hours < 1 ? unitNumber(language, Math.round(hours * 60), "minute", "narrow") : unitNumber(language, hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours), "hour", "narrow")
}
