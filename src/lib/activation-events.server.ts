import { env } from "cloudflare:workers"

/** `ab_events.variant` value for recorder activation counts, beside the `tool:` keys so no migration is needed. */
export const RECORDER_COUNTER_KEY = "app:recorder"

type RecorderEvent = "first_recording" | "returning_recorder"

/**
 * Counts, per day, a person's first completed video (`first_recording`) and the first video of a later day for someone
 * who has recorded before (`returning_recorder`, so one per person per day). Anonymous: only the day and event name are
 * stored. Best effort; a failure must never fail the recording.
 */
export async function countRecorderActivation(ownerId: string, uploadId: string, createdAt: string): Promise<RecorderEvent | null> {
  try {
    const prior = await env.DB.prepare(
      "SELECT count(*) AS total, coalesce(sum(date(created_at) = date(?)), 0) AS same_day FROM uploads WHERE owner_id = ? AND media_type = 'video' AND status = 'ready' AND id != ?",
    )
      .bind(createdAt, ownerId, uploadId)
      .first<{ total: number; same_day: number }>()
    const event: RecorderEvent | null = !prior || prior.total === 0 ? "first_recording" : prior.same_day === 0 ? "returning_recorder" : null
    if (!event) return null
    await env.DB.prepare(
      "INSERT INTO ab_events (day, variant, event, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, variant, event) DO UPDATE SET n = n + 1",
    )
      .bind(new Date().toISOString().slice(0, 10), RECORDER_COUNTER_KEY, event)
      .run()
    return event
  } catch {
    return null
  }
}
