import { useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { ANALYTICS_ACCOUNT_SAVED, ANALYTICS_CONSENT_CHANGED, ANALYTICS_LOADED, syncAnalyticsUser } from "@/lib/posthog"

/** Identity follows auth on every app page, including recorder and auth callbacks. */
export function AnalyticsIdentity() {
  const { data, isPending } = authClient.useSession()
  const user = data?.user as { id: string; isAnonymous?: boolean } | undefined
  const [savedGuest, setSavedGuest] = useState<string | null>(null)
  useEffect(() => {
    if (!user?.isAnonymous || isPending) return
    let active = true
    const check = () => void authClient.passkey.listUserPasskeys().then((result) => {
      if (active) setSavedGuest(result.data?.length ? user.id : null)
    }).catch(() => {})
    check()
    addEventListener(ANALYTICS_ACCOUNT_SAVED, check)
    return () => { active = false; removeEventListener(ANALYTICS_ACCOUNT_SAVED, check) }
  }, [user?.id, user?.isAnonymous, isPending])
  // Don't identify temporary guests: identifying a second account later cannot merge two identified people.
  const id = isPending ? undefined : user && (!user.isAnonymous || savedGuest === user.id) ? user.id : null
  useEffect(() => {
    const sync = () => syncAnalyticsUser(id)
    sync()
    addEventListener(ANALYTICS_LOADED, sync)
    addEventListener(ANALYTICS_CONSENT_CHANGED, sync)
    return () => {
      removeEventListener(ANALYTICS_LOADED, sync)
      removeEventListener(ANALYTICS_CONSENT_CHANGED, sync)
    }
  }, [id])
  return null
}
