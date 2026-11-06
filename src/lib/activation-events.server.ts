import { env } from "cloudflare:workers"

/** `ab_events.variant` value for recorder activation counts, beside the `tool:` keys so no migration is needed. */
export const RECORDER_COUNTER_KEY = "app:recorder"

/** Product actions that follow from a recording: someone watched it, an editor cut it, an agent read or sent something. */
export const SHARE_COUNTER_KEY = "app:share"
export const EDITOR_COUNTER_KEY = "app:editor"
export const AGENT_COUNTER_KEY = "app:agent"

type RecorderEvent = "first_recording" | "returning_recorder"

type AppEvent =
  | { key: typeof RECORDER_COUNTER_KEY; event: RecorderEvent | "recording_completed" }
  | { key: typeof SHARE_COUNTER_KEY; event: "first_external_view" }
  | { key: typeof EDITOR_COUNTER_KEY; event: "cuts_saved" }
  | { key: typeof AGENT_COUNTER_KEY; event: "brief_copied" | "mcp_connected" }

/**
 * Adds one to today's count for an anonymous product event. Only the day, a fixed key and a fixed event name are stored,
 * never an account, video or device. Best effort: a failure must never fail the request that triggered it.
 */
export async function countAppEvent({ key, event }: AppEvent): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO ab_events (day, variant, event, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, variant, event) DO UPDATE SET n = n + 1",
    )
      .bind(new Date().toISOString().slice(0, 10), key, event)
      .run()
  } catch {
    /* counting is best effort */
  }
}

/**
 * Counts every completed video (`recording_completed`), and per day a person's first completed video (`first_recording`)
 * and the first video of a later day for someone who has recorded before (`returning_recorder`, so one per person per day).
 */
export async function countRecorderActivation(ownerId: string, uploadId: string, createdAt: string): Promise<RecorderEvent | null> {
  try {
    await countAppEvent({ key: RECORDER_COUNTER_KEY, event: "recording_completed" })
    const prior = await env.DB.prepare(
      "SELECT count(*) AS total, coalesce(sum(date(created_at) = date(?)), 0) AS same_day FROM uploads WHERE owner_id = ? AND media_type = 'video' AND status = 'ready' AND id != ?",
    )
      .bind(createdAt, ownerId, uploadId)
      .first<{ total: number; same_day: number }>()
    const event: RecorderEvent | null = !prior || prior.total === 0 ? "first_recording" : prior.same_day === 0 ? "returning_recorder" : null
    if (!event) return null
    await countAppEvent({ key: RECORDER_COUNTER_KEY, event })
    return event
  } catch {
    return null
  }
}
