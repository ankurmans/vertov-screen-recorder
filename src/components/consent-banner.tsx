import { useEffect, useState } from "react"
import { ANALYTICS_LOADED, acceptAnalytics, consentStatus, declineAnalytics } from "@/lib/posthog"

/** Asks once whether PostHog may use cookies. Either answer is remembered by PostHog itself. */
export function ConsentBanner() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (location.pathname.startsWith("/embed/")) return
    const check = () => setOpen(consentStatus() === "pending")
    check()
    addEventListener(ANALYTICS_LOADED, check)
    return () => removeEventListener(ANALYTICS_LOADED, check)
  }, [])
  if (!open) return null
  const choose = (accept: boolean) => {
    if (accept) acceptAnalytics()
    else declineAnalytics()
    setOpen(false)
  }
  return (
    <div
      role="region"
      aria-label="Cookie choice"
      className="pop-in fixed right-0 bottom-0 left-0 z-50 p-3 sm:right-auto sm:left-4 sm:bottom-4 sm:p-0"
    >
      <div className="flex max-w-md flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-xl sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 leading-snug">
          May we use analytics cookies to see how Vertov is used? Without them we only count visits anonymously. <a href="/privacy" className="font-medium text-neutral-900 underline underline-offset-2">Privacy</a>
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 hover:bg-neutral-50">
            No thanks
          </button>
          <button type="button" onClick={() => choose(true)} className="rounded-lg bg-neutral-900 px-3 py-1.5 font-semibold text-white hover:bg-neutral-800">
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
