import { useEffect, useId, useState } from "react"
import { APP_LANGUAGES, LANGUAGE_COOKIE, LANGUAGE_NAMES, isAppLanguage } from "@/lib/i18n/languages"
import { useLanguage, useT } from "@/lib/i18n/react"

/** Browser-side cookie write for signed-out visitors (signed-in users save through the API, which also sets it). */
function rememberInCookie(language: string) {
  document.cookie = `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
}

/** Keeps a saved or ?lang= language in a cookie, so later page loads need no database read and the choice outlives the query string. */
export function useRememberSavedLanguage(source: string, language: string) {
  useEffect(() => {
    if (source === "saved" || source === "query") rememberInCookie(language)
  }, [source, language])
}

/**
 * The app language picker. Signed-in users save it to their account; signed-out visitors keep it in this browser.
 * Each option is written in its own language so it can be found whatever language is showing.
 */
export function LanguageSelect({ signedIn, compact = false }: { signedIn: boolean; compact?: boolean }) {
  const t = useT()
  const language = useLanguage()
  const id = useId()
  const [status, setStatus] = useState<"idle" | "saving" | "failed">("idle")

  async function choose(next: string) {
    if (!isAppLanguage(next) || next === language) return
    setStatus("saving")
    try {
      if (signedIn) {
        const response = await fetch("/api/preferences/language", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: next }) })
        if (!response.ok) throw new Error(String(response.status))
      } else rememberInCookie(next)
      // A full load re-renders the document language, the page title and the consent banner together.
      window.location.reload()
    } catch {
      setStatus("failed")
    }
  }

  return (
    <div className={compact ? "inline-flex items-center gap-2" : "flex flex-col gap-2"}>
      <label htmlFor={id} className={compact ? "sr-only" : "text-sm font-medium text-neutral-800"}>{t("language.selectorLabel")}</label>
      <select
        id={id}
        value={language}
        disabled={status === "saving"}
        onChange={(event) => void choose(event.target.value)}
        className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
      >
        {APP_LANGUAGES.map((code) => (
          <option key={code} value={code} lang={code === "pt-br" ? "pt-BR" : code === "pt-pt" ? "pt-PT" : code}>{LANGUAGE_NAMES[code]}</option>
        ))}
      </select>
      <p role="status" aria-live="polite" className={status === "failed" ? "text-sm text-red-600" : "sr-only"}>{status === "failed" ? t("language.saveFailed") : ""}</p>
    </div>
  )
}
