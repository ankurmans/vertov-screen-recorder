import { env } from "cloudflare:workers";

export type LifecycleEvent = "recorded" | "imported" | "shared" | "viewed" | "active";

/** Never sends mail or fails an app action; only a verified account can acquire a milestone. */
export async function recordLifecycleEvent(db: D1Database, userId: string | null | undefined, event: LifecycleEvent, now = Date.now()) {
  if (!userId || !Number.isFinite(now)) return;
  try {
    await db.prepare(`INSERT INTO lifecycle_events(user_id,event,first_at,last_at)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM user WHERE id=? AND emailVerified=1 AND coalesce(isAnonymous,0)=0)
      ON CONFLICT(user_id,event) DO UPDATE SET first_at=min(first_at,excluded.first_at),last_at=max(last_at,excluded.last_at)`)
      .bind(userId,event,now,now,userId).run();
  } catch {
    console.warn("Lifecycle milestone unavailable");
  }
}

export const noteLifecycleEvent = (userId: string | null | undefined, event: LifecycleEvent) =>
  event === "active" && userId ? observeLifecycleActivity(env.DB, userId) : recordLifecycleEvent(env.DB, userId, event);

/** Returning to the library also observes ready videos made as a guest or through another upload client. */
export async function observeLifecycleActivity(db: D1Database, userId: string, now = Date.now()) {
  await recordLifecycleEvent(db, userId, "active", now);
  try {
    const state = await db.prepare(`SELECT
      coalesce(max(source_url IS NULL),0) AS recorded,
      coalesce(max(source_url IS NOT NULL),0) AS imported,
      coalesce(max(last_viewed_at IS NOT NULL),0) AS viewed
      FROM uploads WHERE owner_id=? AND status='ready' AND media_type='video' AND deleted_at IS NULL`)
      .bind(userId).first<{ recorded: number; imported: number; viewed: number }>();
    for (const event of ["recorded", "imported", "viewed"] as const) {
      // Preserve an existing event's timestamp: opening the library is not a new recording/import/view.
      if (state?.[event]) await db.prepare(`INSERT OR IGNORE INTO lifecycle_events(user_id,event,first_at,last_at)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM user WHERE id=? AND emailVerified=1 AND coalesce(isAnonymous,0)=0)`)
        .bind(userId,event,now,now,userId).run();
    }
  } catch { console.warn("Lifecycle activity unavailable"); }
}
