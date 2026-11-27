import { env, waitUntil } from "cloudflare:workers"
import type { MailEnv } from "@/lib/mail.server"
import { allow } from "@/lib/rate-limit.server"
import { withMailer } from "@/lib/mail.server"
import { causeMessage, fingerprintOf, ignorable, scrub, stackFrames, withCause, withoutParams, withoutStoredParams } from "@/lib/error-fingerprint"

/**
 * Error tracking. `reportError` records one failure under a fingerprint (same failure, same row, a counter), and emails the
 * owner when a fingerprint is new, comes back after being marked resolved, or crosses 10, 100, 1,000 occurrences. A daily
 * digest lists everything still open. It never throws and never blocks the request that failed: a tracker that can take
 * the app down is worse than none. Rows hold ids and scrubbed text only, never an email address, a request body or the values
 * bound to a failed query, and each stack (US, EU) keeps its own table, so the EU stack's errors stay in the EU database.
 * Nothing is sent without ERROR_ALERT_EMAIL.
 */
export type ErrorSource = "fetch" | "api" | "queue" | "job" | "cron" | "client" | "mcp"

export interface ErrorContext {
  source: ErrorSource
  /** The route or job kind, with ids already replaced by placeholders where possible. */
  route?: string
  userId?: string | null
  uploadId?: string | null
}

const SPIKES = new Set([10, 100, 1000, 10000])
const MAX_ALERTS_PER_HOUR = 20
const MAX_AFFECTED = 100

interface Row {
  count: number
  status: string
  alerted_at: number | null
  first_seen: number
}

export async function reportError(error: unknown, context: ErrorContext): Promise<void> {
  try {
    const failure = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error))
    const name = failure.name || "Error"
    const original = failure.message || ""
    const safe = withoutParams(original)
    const message = scrub(safe).slice(0, 500)
    // The stack repeats the message, and a value on a line starting "at " would be read as a frame.
    const stack = failure.stack?.replace(original, () => safe)
    if (ignorable(name, message, stack)) return
    const frames = stackFrames(stack)
    // Hashed over the message with its values, as before, so existing rows keep their fingerprints; only the hash is stored.
    // The cause stays out of it, so a failure keeps its row whatever reason D1 gives each time.
    const fingerprint = await fingerprintOf(context.source, name, scrub(original).slice(0, 500), frames)
    const cause = causeMessage(failure)
    const detail = withCause(message, cause)
    const now = Date.now()
    const db = env.DB
    const row = await db
      .prepare(
        `INSERT INTO error_events (fingerprint, source, name, message, stack, route, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(fingerprint) DO UPDATE SET count = count + 1, last_seen = ?7, route = coalesce(?6, route),
           message = CASE WHEN ?8 OR instr(message, char(10) || 'params:') THEN ?4 ELSE message END,
           alerted_at = CASE WHEN status = 'resolved' THEN NULL ELSE alerted_at END,
           status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
         RETURNING count, status, alerted_at, first_seen`,
      )
      .bind(fingerprint, context.source, name.slice(0, 80), detail, frames.join("\n").slice(0, 800) || null, context.route ? scrub(context.route).slice(0, 200) : null, now, cause ? 1 : 0)
      .first<Row>()
    if (!row) return
    if (context.userId || context.uploadId) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO error_affected (fingerprint, user_id, upload_id, created_at)
           SELECT ?1, ?2, ?3, ?4 WHERE (SELECT count(*) FROM error_affected WHERE fingerprint = ?1) < ${MAX_AFFECTED}`,
        )
        .bind(fingerprint, context.userId ?? "", context.uploadId ?? "", now)
        .run()
    }
    if (row.status === "ignored") return
    // A resolved error that fires again was reopened above with alerted_at cleared; that, or an earlier alert the hourly cap
    // swallowed, is what a count above 1 with no alert on record means.
    const first = row.count === 1
    const regression = !first && row.alerted_at === null
    const spike = !first && SPIKES.has(row.count)
    if (!first && !regression && !spike) return
    if (!(await allow("error-alert", MAX_ALERTS_PER_HOUR, 3600))) return
    await db.prepare("UPDATE error_events SET alerted_at = ? WHERE fingerprint = ?").bind(now, fingerprint).run()
    const kind = first ? "new" : regression ? "regression" : "spike"
    await sendAlert({ kind, fingerprint, name, message: detail, frames, count: row.count, context })
    if (kind !== "spike") await wakeFixer(kind, fingerprint)
  } catch {
    console.warn("Error tracker unavailable; the failure was not recorded")
  }
}

interface Alert {
  kind: "new" | "regression" | "spike"
  fingerprint: string
  name: string
  message: string
  frames: Array<string>
  count: number
  context: ErrorContext
}

/**
 * Wakes the hourly error-fix routine (stage 1, opens a PR only) as soon as a new or returning error is alerted, so a fix does
 * not wait for the next scheduled run. The body carries only the kind and the fingerprint: the routine reads the scrubbed error
 * from /api/ops/errors itself. Does nothing unless both secrets are set, and fires at most 4 times an hour per stack.
 */
async function wakeFixer(kind: Alert["kind"], fingerprint: string): Promise<void> {
  const url = Reflect.get(env, "ERROR_FIXER_FIRE_URL")
  const token = Reflect.get(env, "ERROR_FIXER_FIRE_TOKEN")
  if (typeof url !== "string" || !url.startsWith("https://api.anthropic.com/") || typeof token !== "string" || !token) return
  if (!(await allow("error-fixer-fire", 4, 3600))) return
  try {
    await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ text: `${kind} error ${fingerprint} on ${stackLabel()}` }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    console.warn("Error fixer could not be woken")
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const stackLabel = () => (String(Reflect.get(env, "VERTOV_REGION")) === "eu" ? "vertov-eu" : "vertov")

async function sendAlert(alert: Alert): Promise<void> {
  const to = Reflect.get(env, "ERROR_ALERT_EMAIL")
  if (typeof to !== "string" || !to) return
  const mail = withMailer(env as unknown as MailEnv)
  if (!mail.EMAIL || !mail.EMAIL_FROM) return
  const title = { new: "New error", regression: "Error is back", spike: `Error spiking (${alert.count} times)` }[alert.kind]
  const lines = [
    `${alert.name}: ${alert.message}`,
    `Source: ${alert.context.source}${alert.context.route ? ` ${alert.context.route}` : ""}`,
    `Seen: ${alert.count} time${alert.count === 1 ? "" : "s"}`,
    ...(alert.context.uploadId ? [`Video id: ${alert.context.uploadId}`] : []),
    `Fingerprint: ${alert.fingerprint}`,
    "",
    ...alert.frames,
  ]
  const text = lines.join("\n")
  const html = `<h1 style="font-size:24px;margin:0 0 12px">${escapeHtml(title)}</h1><p>Stack: ${escapeHtml(stackLabel())}. Review the recorded error before taking action.</p><pre style="font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`
  await mail.EMAIL.send({
    audit: { stream: "transactional", template: "error-alert" },
    to,
    from: mail.EMAIL_FROM,
    subject: `[${stackLabel()}] ${{ new: "New error", regression: "Error returned", spike: "Error spike" }[alert.kind]} 🚨`,
    text,
    html,
  })
}

/** The daily digest: every error still open that fired in the last day, most frequent first. A day with none sends nothing. */
export async function sendErrorDigest(): Promise<{ open: number; sent: boolean }> {
  const to = Reflect.get(env, "ERROR_ALERT_EMAIL")
  const since = Date.now() - 86_400_000
  const { results } = await env.DB.prepare("SELECT fingerprint, name, message, route, count, last_seen FROM error_events WHERE status = 'open' AND last_seen > ? ORDER BY count DESC LIMIT 25").bind(since).all<{
    fingerprint: string
    name: string
    message: string
    route: string | null
    count: number
    last_seen: number
  }>()
  if (results.length === 0 || typeof to !== "string" || !to) return { open: results.length, sent: false }
  const mail = withMailer(env as unknown as MailEnv)
  if (!mail.EMAIL || !mail.EMAIL_FROM) return { open: results.length, sent: false }
  const text = results.map((row) => `${row.count}x  ${row.name}: ${withoutStoredParams(row.message)}${row.route ? `  (${row.route})` : ""}  [${row.fingerprint}]`).join("\n")
  await mail.EMAIL.send({
    audit: { stream: "transactional", template: "error-digest" },
    to,
    from: mail.EMAIL_FROM,
    subject: `[${stackLabel()}] Error digest 📋`,
    text,
    html: `<h1 style="font-size:24px;margin:0 0 12px">Open errors in the last 24 hours</h1><p>${results.length} error fingerprints need a review on ${escapeHtml(stackLabel())}.</p><pre style="font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
  })
  return { open: results.length, sent: true }
}

/** Hands a failure to the tracker without making the caller wait for it. */
export function trackError(error: unknown, context: ErrorContext): void {
  waitUntil(reportError(error, context))
}
