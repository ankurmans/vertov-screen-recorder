import { and, desc, eq, isNull } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { SessionUser } from "@/lib/auth.server"
import type { Role } from "@/lib/plans"
import type { WorkspaceContext } from "@/lib/workspace.server"
import { db } from "@/db"
import { workspaceInvites } from "@/db/schema"
import { json } from "@/lib/api.server"
import { canManage } from "@/lib/plans"
import { userApi } from "@/lib/recordings.server"
import { getWorkspaceContext } from "@/lib/workspace.server"

/** Runs the handler in the caller's active workspace; `manage` limits it to owners and admins. */
export function workspaceApi(
  request: Request,
  handler: (user: SessionUser, context: WorkspaceContext) => Promise<Response>,
  options: { manage?: boolean } = {},
): Promise<Response> {
  return userApi(request, async (user) => {
    const context = await getWorkspaceContext(request, user)
    if (options.manage && !canManage(context.role)) return json({ error: "Only workspace owners and admins can do that" }, 403)
    return handler(user, context)
  })
}

export interface Member {
  userId: string
  name: string
  email: string | null
  avatar: string
  role: Role
  joinedAt: string
}

export async function listMembers(workspaceId: string): Promise<Array<Member>> {
  const { results } = await env.DB.prepare(
    `SELECT m.user_id AS userId, m.role, m.created_at AS joinedAt, u.name, u.email, u.image, u."isAnonymous" AS anon
     FROM workspace_members m JOIN "user" u ON u.id = m.user_id
     WHERE m.workspace_id = ? ORDER BY m.created_at`,
  )
    .bind(workspaceId)
    .all<{ userId: string; role: Role; joinedAt: string; name: string; email: string; image: string | null; anon: number | null }>()
  return results.map((row) => {
    const name = row.name.trim() || (row.anon ? "Passkey user" : row.email.split("@")[0])
    return {
      userId: row.userId,
      name,
      email: row.anon ? null : row.email,
      avatar: row.image || `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(name)}`,
      role: row.role,
      joinedAt: row.joinedAt,
    }
  })
}

export function listInvites(workspaceId: string) {
  return db
    .select({ id: workspaceInvites.id, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt, createdAt: workspaceInvites.createdAt })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, workspaceId), isNull(workspaceInvites.revokedAt)))
    .orderBy(desc(workspaceInvites.createdAt))
    .then((rows) => rows.filter((row) => Date.parse(row.expiresAt) > Date.now()))
}
