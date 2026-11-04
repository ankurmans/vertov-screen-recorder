import { clientIp } from "@/lib/rate-limit.server"

/**
 * True when the caller has used up a Workers Rate Limiting binding. Unlike `allow` in rate-limit.server.ts it costs no
 * D1 write, which matters for the anonymous analytics counters it protects. The limit is per Cloudflare location and
 * approximate. A missing or failing binding allows the request: these are counters, not a security boundary.
 */
export async function overLimit(limiter: RateLimit | undefined, request: Request): Promise<boolean> {
  if (!limiter) return false
  try {
    return !(await limiter.limit({ key: clientIp(request) })).success
  } catch {
    return false
  }
}
