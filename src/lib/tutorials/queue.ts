import { CLAIM_SECONDS, MAX_ATTEMPTS } from "./jobs"
import type { JobState, TutorialJob } from "./jobs"

/**
 * Job queue logic over a D1-shaped handle, kept free of Worker imports so tests can run it on SQLite.
 * Every statement is scoped by workspace, and every runner write is scoped by the runner that holds the claim.
 */

export interface Db {
  prepare(sql: string): {
    bind(...values: Array<unknown>): {
      first<T = Record<string, unknown>>(): Promise<T | null>
      all<T = Record<string, unknown>>(): Promise<{ results: Array<T> }>
      run(): Promise<{ meta?: { changes?: number } }>
    }
  }
}

/** SQLite's datetime('now') format, so comparisons are plain string comparisons. */
export const stamp = (date = new Date()) => date.toISOString().slice(0, 19).replace("T", " ")
const plusSeconds = (now: string, seconds: number) => stamp(new Date(new Date(`${now.replace(" ", "T")}Z`).getTime() + seconds * 1000))

interface Row {
  id: string
  workspace_id: string
  created_by: string
  recipe_id: string
  recipe_version: number
  title: string
  parameters: string
  presenter: number
  state: JobState
  attempts: number
  claimed_by: string | null
  claim_expires_at: string | null
  stage: string | null
  step: string | null
  message: string | null
  percent: number
  error: string | null
  video_id: string | null
  verified: string | null
  cancel_requested: number
  created_at: string
  updated_at: string
  completed_at: string | null
}

export function toJob(row: Row, origin = ""): TutorialJob {
  let parameters: Record<string, string> = {}
  let verified: TutorialJob["verified"] = []
  try {
    parameters = JSON.parse(row.parameters)
    verified = row.verified ? JSON.parse(row.verified) : []
  } catch {
    // A row we wrote ourselves; fall back to empty rather than fail a status read.
  }
  return {
    id: row.id,
    recipeId: row.recipe_id,
    recipeVersion: row.recipe_version,
    title: row.title,
    parameters,
    presenter: Boolean(row.presenter),
    state: row.state,
    attempts: row.attempts,
    stage: row.stage,
    step: row.step,
    message: row.message,
    percent: row.percent,
    error: row.error,
    videoId: row.video_id,
    videoUrl: row.video_id ? `${origin}/${row.video_id}` : null,
    verified,
    cancelRequested: Boolean(row.cancel_requested),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

export async function createJob(
  db: Db,
  input: { id: string; workspaceId: string; userId: string; recipeId: string; recipeVersion: number; title: string; parameters: Record<string, string>; presenter: boolean },
): Promise<void> {
  await db
    .prepare("INSERT INTO tutorial_jobs (id, workspace_id, created_by, recipe_id, recipe_version, title, parameters, presenter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(input.id, input.workspaceId, input.userId, input.recipeId, input.recipeVersion, input.title, JSON.stringify(input.parameters), Number(input.presenter))
    .run()
}

export async function getJob(db: Db, workspaceId: string, id: string): Promise<Row | null> {
  return db.prepare("SELECT * FROM tutorial_jobs WHERE id = ? AND workspace_id = ?").bind(id, workspaceId).first<Row>()
}

export async function listJobs(db: Db, workspaceId: string, limit = 30): Promise<Array<Row>> {
  const { results } = await db.prepare("SELECT * FROM tutorial_jobs WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").bind(workspaceId, limit).all<Row>()
  return results
}

export async function touchRunner(db: Db, workspaceId: string, runnerId: string, now = stamp()): Promise<void> {
  await db
    .prepare("INSERT INTO tutorial_runners (workspace_id, runner_id, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id, runner_id) DO UPDATE SET last_seen_at = excluded.last_seen_at")
    .bind(workspaceId, runnerId, now)
    .run()
}

/** A runner counts as available if it asked for work within the last minute and a half. */
export async function runnerOnline(db: Db, workspaceId: string, now = stamp()): Promise<boolean> {
  const since = plusSeconds(now, -90)
  const row = await db.prepare("SELECT 1 AS online FROM tutorial_runners WHERE workspace_id = ? AND last_seen_at >= ? LIMIT 1").bind(workspaceId, since).first()
  return Boolean(row)
}

/** Jobs whose runner went quiet: cancelled if cancellation was asked for, failed once the attempts are used up. */
async function sweepExpired(db: Db, workspaceId: string, now: string): Promise<void> {
  await db
    .prepare("UPDATE tutorial_jobs SET state = 'cancelled', error = 'Cancelled', completed_at = ?1, updated_at = ?1 WHERE workspace_id = ?2 AND state = 'running' AND claim_expires_at <= ?1 AND cancel_requested = 1")
    .bind(now, workspaceId)
    .run()
  await db
    .prepare("UPDATE tutorial_jobs SET state = 'failed', error = 'The runner stopped responding and the job ran out of attempts.', completed_at = ?1, updated_at = ?1 WHERE workspace_id = ?2 AND state = 'running' AND claim_expires_at <= ?1 AND attempts >= ?3")
    .bind(now, workspaceId, MAX_ATTEMPTS)
    .run()
}

/** Hands the oldest waiting (or abandoned) job to this runner, atomically. */
export async function claimNext(db: Db, workspaceId: string, runnerId: string, now = stamp()): Promise<Row | null> {
  await touchRunner(db, workspaceId, runnerId, now)
  await sweepExpired(db, workspaceId, now)
  return db
    .prepare(
      `UPDATE tutorial_jobs SET state = 'running', claimed_by = ?1, claim_expires_at = ?2, attempts = attempts + 1, stage = 'preparing', step = NULL, message = 'Runner started', percent = 0, error = NULL, updated_at = ?3
       WHERE id = (SELECT id FROM tutorial_jobs WHERE workspace_id = ?4 AND cancel_requested = 0 AND attempts < ?5 AND (state = 'queued' OR (state = 'running' AND claim_expires_at <= ?3)) ORDER BY created_at, rowid LIMIT 1)
       AND workspace_id = ?4 AND cancel_requested = 0 AND (state = 'queued' OR (state = 'running' AND claim_expires_at <= ?3))
       RETURNING *`,
    )
    .bind(runnerId, plusSeconds(now, CLAIM_SECONDS), now, workspaceId, MAX_ATTEMPTS)
    .first<Row>()
}

export type RunnerResult = { ok: true; cancel: boolean } | { ok: false; reason: "not_found" | "not_yours" | "not_running" | "expired" }

async function holder(db: Db, workspaceId: string, id: string, runnerId: string): Promise<{ row: Row | null; failure: RunnerResult | null }> {
  const row = await getJob(db, workspaceId, id)
  if (!row) return { row: null, failure: { ok: false, reason: "not_found" } }
  if (row.state !== "running") return { row, failure: { ok: false, reason: "not_running" } }
  if (row.claimed_by !== runnerId) return { row, failure: { ok: false, reason: "not_yours" } }
  return { row, failure: null }
}

export async function reportProgress(
  db: Db,
  workspaceId: string,
  id: string,
  runnerId: string,
  progress: { stage: string; step?: string; message?: string; percent?: number },
  now = stamp(),
): Promise<RunnerResult> {
  const { row, failure } = await holder(db, workspaceId, id, runnerId)
  if (failure) return failure
  if (row && row.claim_expires_at && row.claim_expires_at <= now) return { ok: false, reason: "expired" }
  await touchRunner(db, workspaceId, runnerId, now)
  await db
    .prepare("UPDATE tutorial_jobs SET stage = ?, step = ?, message = ?, percent = COALESCE(?, percent), claim_expires_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND state = 'running' AND claimed_by = ?")
    .bind(progress.stage, progress.step ?? null, progress.message ?? null, progress.percent ?? null, plusSeconds(now, CLAIM_SECONDS), now, id, workspaceId, runnerId)
    .run()
  return { ok: true, cancel: Boolean(row?.cancel_requested) }
}

/**
 * Marks the job finished with its video. Repeating the call with the same video is a no-op, and a second video can't be
 * attached, so an interrupted upload that is retried never publishes twice.
 */
export async function completeJob(
  db: Db,
  workspaceId: string,
  id: string,
  runnerId: string,
  result: { videoId: string; verified: unknown },
  now = stamp(),
): Promise<RunnerResult & { already?: boolean }> {
  const row = await getJob(db, workspaceId, id)
  if (!row) return { ok: false, reason: "not_found" }
  if (row.state === "completed") return row.video_id === result.videoId && row.claimed_by === runnerId ? { ok: true, cancel: false, already: true } : { ok: false, reason: "not_running" }
  if (row.state !== "running") return { ok: false, reason: "not_running" }
  if (row.claimed_by !== runnerId) return { ok: false, reason: "not_yours" }
  const taken = await db.prepare("SELECT id FROM tutorial_jobs WHERE video_id = ? AND id != ?").bind(result.videoId, id).first()
  if (taken) return { ok: false, reason: "not_yours" }
  const done = await db
    .prepare("UPDATE tutorial_jobs SET state = 'completed', video_id = ?, verified = ?, stage = NULL, step = NULL, message = 'Finished', percent = 100, error = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND state = 'running' AND claimed_by = ?")
    .bind(result.videoId, JSON.stringify(result.verified), now, now, id, workspaceId, runnerId)
    .run()
  return done.meta?.changes ? { ok: true, cancel: false } : { ok: false, reason: "not_running" }
}

/** A runner reports a failure. Cancellation wins; a retryable failure goes back in the queue while attempts remain. */
export async function failJob(
  db: Db,
  workspaceId: string,
  id: string,
  runnerId: string,
  failure: { error: string; stepId?: string; retryable: boolean },
  now = stamp(),
): Promise<RunnerResult & { state?: JobState }> {
  const { row, failure: refused } = await holder(db, workspaceId, id, runnerId)
  if (refused || !row) return refused ?? { ok: false, reason: "not_found" }
  const state: JobState = row.cancel_requested ? "cancelled" : failure.retryable && row.attempts < MAX_ATTEMPTS ? "queued" : "failed"
  const terminal = state !== "queued"
  await db
    .prepare(
      "UPDATE tutorial_jobs SET state = ?, error = ?, step = ?, claimed_by = CASE WHEN ? THEN claimed_by ELSE NULL END, claim_expires_at = NULL, completed_at = CASE WHEN ? THEN ? ELSE NULL END, updated_at = ? WHERE id = ? AND workspace_id = ? AND state = 'running' AND claimed_by = ?",
    )
    .bind(state, state === "cancelled" ? "Cancelled" : failure.error, failure.stepId ?? row.step, Number(terminal), Number(terminal), now, now, id, workspaceId, runnerId)
    .run()
  return { ok: true, cancel: false, state }
}

/** Queued jobs cancel at once; a running job is flagged and its runner stops at the next progress report. */
export async function cancelJob(db: Db, workspaceId: string, id: string, now = stamp()): Promise<JobState | "not_found"> {
  const row = await getJob(db, workspaceId, id)
  if (!row) return "not_found"
  if (row.state === "queued") {
    await db.prepare("UPDATE tutorial_jobs SET state = 'cancelled', error = 'Cancelled', cancel_requested = 1, completed_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND state = 'queued'").bind(now, now, id, workspaceId).run()
    return "cancelled"
  }
  if (row.state === "running") {
    await db.prepare("UPDATE tutorial_jobs SET cancel_requested = 1, message = 'Cancelling', updated_at = ? WHERE id = ? AND workspace_id = ? AND state = 'running'").bind(now, id, workspaceId).run()
    return "running"
  }
  return row.state
}
