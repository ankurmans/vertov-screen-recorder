/**
 * What a viewer ping may cost, by plan. Free workspaces share the same databases as paid ones, so a viral free video gets
 * a lower ceiling; paid plans get ten times the room. Self-hosted installs have no ceiling. Every number here is listed in
 * docs/limits.md; the per-minute ceilings are the Workers Rate Limiting bindings in wrangler.jsonc (per Cloudflare
 * location, approximate), repeated here only so the docs and tests have one place to read them.
 */
export const PING_LIMITS = {
  /** View pings a single video accepts per minute at one Cloudflare location. Counted views beyond it are dropped. */
  viewsPerMinute: { free: 300, paid: 3000 },
  /** Progress pings one viewer may send for one video per minute (a full watch sends about 25 in all). */
  progressPerMinutePerViewer: 20,
  /** Detailed rows (one per view, one per viewer's progress) kept per video; past it the view counter still counts. */
  rowsPerVideo: { free: 2_000, paid: 50_000 },
} as const

export const rowCap = (free: boolean) => (free ? PING_LIMITS.rowsPerVideo.free : PING_LIMITS.rowsPerVideo.paid)
