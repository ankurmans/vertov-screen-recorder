import { useEffect, useState } from "react"
import { loadGoogleTag } from "@/lib/google-tag"
import { ANALYTICS_LOADED, acceptAnalytics, consentStatus, declineAnalytics } from "@/lib/posthog"

const consentCopy: Record<string, readonly [label: string, prompt: string, privacy: string, decline: string, accept: string]> = {
  en: ["Cookie choice", "May we use analytics cookies to see how Vertov is used? Without them we only count visits anonymously.", "Privacy", "No thanks", "Allow"],
  es: ["Preferencias de cookies", "¿Podemos usar cookies de análisis para saber cómo se usa Vertov? Sin ellas, solo contamos las visitas de forma anónima.", "Privacidad", "No, gracias", "Permitir"],
  fr: ["Choix des cookies", "Pouvons-nous utiliser des cookies de mesure d’audience pour comprendre comment Vertov est utilisé ? Sans eux, nous comptons seulement les visites de façon anonyme.", "Confidentialité", "Non merci", "Autoriser"],
  de: ["Cookie-Einstellungen", "Dürfen wir Analyse-Cookies verwenden, um zu verstehen, wie Vertov genutzt wird? Ohne diese Cookies zählen wir Besuche nur anonym.", "Datenschutz", "Nein, danke", "Erlauben"],
  "pt-BR": ["Preferências de cookies", "Podemos usar cookies de análise para entender como o Vertov é usado? Sem eles, só contamos visitas de forma anônima.", "Privacidade", "Não, obrigado", "Permitir"],
  "pt-PT": ["Preferências de cookies", "Podemos usar cookies de análise para perceber como o Vertov é utilizado? Sem eles, apenas contamos as visitas de forma anónima.", "Privacidade", "Não, obrigado", "Permitir"],
}

/** Asks once whether PostHog may use cookies. Either answer is remembered by PostHog itself. */
export function ConsentBanner() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (location.pathname.startsWith("/embed/")) return
    const check = () => {
      setOpen(consentStatus() === "pending")
      if (consentStatus() === "granted") loadGoogleTag()
    }
    check()
    addEventListener(ANALYTICS_LOADED, check)
    return () => removeEventListener(ANALYTICS_LOADED, check)
  }, [])
  if (!open) return null
  const [label, prompt, privacy, decline, allow] = consentCopy[document.documentElement.lang] ?? consentCopy.en
  const choose = (accept: boolean) => {
    if (accept) {
      acceptAnalytics()
      loadGoogleTag()
    } else declineAnalytics()
    setOpen(false)
  }
  return (
    <div
      role="region"
      aria-label={label}
      className="pop-in fixed right-0 bottom-0 left-0 z-50 p-3 sm:right-auto sm:left-4 sm:bottom-4 sm:p-0"
    >
      <div className="flex max-w-md flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-xl sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 leading-snug">
          {prompt} <a href="/privacy" className="font-semibold text-neutral-900 hover:text-neutral-600">{privacy}</a>
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 hover:bg-neutral-50">
            {decline}
          </button>
          <button type="button" onClick={() => choose(true)} className="rounded-lg bg-neutral-900 px-3 py-1.5 font-semibold text-white hover:bg-neutral-800">
            {allow}
          </button>
        </div>
      </div>
    </div>
  )
}
