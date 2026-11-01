import { env } from "cloudflare:workers"
import { newId } from "@/lib/workspace.server"

/** Records who did what in a workspace. Best-effort: a failure here never breaks the action being logged. */
export async function audit(workspaceId: string | null | undefined, actorId: string | null, action: string, target?: string | null, detail?: string | null): Promise<void> {
  if (!workspaceId) return
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

const csvCell = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`

export function auditCsv(entries: Array<AuditEntry>): string {
  const rows = [["When (UTC)", "Who", "Action", "Target", "Detail"], ...entries.map((entry) => [entry.createdAt, entry.actorName ?? entry.actorId, entry.action, entry.target, entry.detail])]
  return rows.map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n") + "\n"
}
