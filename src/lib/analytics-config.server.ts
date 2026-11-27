import { env } from "cloudflare:workers"
import type { AnalyticsConfig } from "@/lib/posthog"

/** PostHog settings from Worker vars; null (no analytics) when unset, as in the public edition. */
export function analyticsConfig(): AnalyticsConfig | null {
  const vars = env as unknown as Record<string, string | undefined>
  const key = vars.POSTHOG_KEY?.trim()
  if (!key) return null
  return { key, host: vars.POSTHOG_HOST?.trim() || "https://us.i.posthog.com" }
}
