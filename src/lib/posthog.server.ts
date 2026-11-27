import { env, waitUntil } from "cloudflare:workers"
import type { EventProps, ServerEvent } from "@/lib/posthog-events"
import { accountCohortSql } from "@/lib/analytics-cohort"
import { captureBody } from "@/lib/posthog-events"
import { currentRegion } from "@/lib/region.server"

const TIMEOUT_MS = 3000

interface CaptureOptions {
  /** Person properties to set on every call. */
  set?: EventProps
  /** Person properties that are only written the first time. */
  setOnce?: EventProps
  /** False for ids that are not people (a workspace), so PostHog creates no profile. */
  person?: boolean
}

/**
 * Sends one product event to PostHog for a signed-in account. Runs after the response (waitUntil), never throws, and does nothing
 * without a POSTHOG_KEY, in local dev, or without an id, so the public edition and tests are unaffected. Use posthog-events.ts for
 * the allowed names and read its note on what a property may hold.
 */
export function captureServer(event: ServerEvent, distinctId: string | null | undefined, props?: EventProps, options: CaptureOptions = {}): void {
  try {
    if (import.meta.env.DEV || !distinctId) return
    const vars = env as unknown as Record<string, string | undefined>
    const key = vars.POSTHOG_KEY?.trim()
    if (!key) return
    const host = (vars.POSTHOG_SERVER_HOST?.trim() || vars.POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "")
    waitUntil((async () => {
      let cohort: string | undefined
      if (options.person !== false) {
        try {
          cohort = (await env.DB.prepare(`SELECT ${accountCohortSql} AS cohort FROM user u WHERE u.id=?`).bind(distinctId).first<{ cohort: string }>())?.cohort
        } catch { /* Keep the event if reporting classification is unavailable. */ }
      }
      const labels: EventProps = cohort ? { account_cohort: cohort, is_internal: ["internal", "review", "demo"].includes(cohort) } : {}
      const body = JSON.stringify(captureBody(key, event, distinctId, { ...props, ...labels, deployment_region: currentRegion() }, {
        ...options, set: { ...options.set, ...labels },
      }))
      const response = await fetch(`${host}/i/v0/e/`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) console.warn(JSON.stringify({ message: "Product analytics rejected", status: response.status }))
    })().catch(() => {
      console.warn(JSON.stringify({ message: "Product analytics unavailable" }))
    }))
  } catch {
    /* analytics is best effort and must never fail the request */
  }
}
