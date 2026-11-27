import { env } from "cloudflare:workers"
import { csv } from "@/lib/csv"
import { newId } from "@/lib/workspace.server"
import { captureServer } from "@/lib/posthog.server"

/** Records who did what in a workspace. Best-effort: a failure here never breaks the action being logged. */
export async function audit(workspaceId: string | null | undefined, actorId: string | null, action: string, target?: string | null, detail?: string | null): Promise<void> {
  if (!workspaceId) return
  // Only the action name goes to PostHog: the target and detail can hold titles and emails.
  captureServer("workspace_action", actorId, { action: action.replace(/[^a-z_.]/g, "").slice(0, 40) })
  try {
    await env.DB.prepare("INSERT INTO audit_log (id, workspace_id, actor_id, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId("a"), workspaceId, actorId, action, target ?? null, detail ?? null)
      .run()
  } catch (error) {
    console.error(JSON.stringify({ message: "Audit log failed", action, error: error instanceof Error ? error.message : String(error) }))
  }
}

export interface AuditEntry {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  target: string | null
  detail: string | null
  createdAt: string
}

export async function listAudit(workspaceId: string, limit = 100): Promise<Array<AuditEntry>> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.actor_id AS actorId, u.name AS actorName, a.action, a.target, a.detail, a.created_at AS createdAt
     FROM audit_log a LEFT JOIN "user" u ON u.id = a.actor_id
     WHERE a.workspace_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`,
  )
    .bind(workspaceId, limit)
    .all<AuditEntry>()
  return results
}

/** Target, detail and names hold member-written text, so cells go through the shared writer that defuses formulas. */
export function auditCsv(entries: Array<AuditEntry>): string {
  return csv([["When (UTC)", "Who", "Action", "Target", "Detail"], ...entries.map((entry) => [entry.createdAt, entry.actorName ?? entry.actorId, entry.action, entry.target, entry.detail])])
}
