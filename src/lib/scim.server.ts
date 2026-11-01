import { env } from "cloudflare:workers"
import type { Workspace } from "@/db/schema"
import { db } from "@/db"
import { audit } from "@/lib/audit.server"
import { sha256Hex } from "@/lib/security.server"

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error"

export const scimError = (status: number, detail: string) =>
  Response.json({ schemas: [ERROR_SCHEMA], status: String(status), detail }, { status, headers: { "content-type": "application/scim+json" } })

export const scimJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "content-type": "application/scim+json" } })

/** The workspace whose SCIM token this request carries, or null. */
export async function scimWorkspace(request: Request): Promise<Workspace | null> {
  const header = request.headers.get("authorization") ?? ""
  if (!header.startsWith("Bearer scim_")) return null
  const hash = await sha256Hex(header.slice(7).trim())
  return (await db.query.workspaces.findFirst({ where: (table, { eq }) => eq(table.scimTokenHash, hash) })) ?? null
}

export async function scimApi(request: Request, handler: (workspace: Workspace) => Promise<Response>): Promise<Response> {
  const workspace = await scimWorkspace(request)
  if (!workspace) return scimError(401, "Invalid or missing SCIM token")
  try {
    return await handler(workspace)
  } catch (error) {
    return scimError(500, error instanceof Error ? error.message : "Something went wrong")
  }
}

interface Row {
  id: string
  name: string
  email: string
  member: number
  createdAt: string | null
}

const resource = (row: Row, origin: string) => ({
  schemas: [USER_SCHEMA],
  id: row.id,
  userName: row.email,
  displayName: row.name,
  name: { formatted: row.name },
  emails: [{ value: row.email, primary: true }],
  active: Boolean(row.member),
  meta: { resourceType: "User", created: row.createdAt, location: `${origin}/scim/v2/Users/${row.id}` },
})

const SELECT = `SELECT u.id, u.name, u.email, u."createdAt" AS createdAt,
  CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS member
  FROM "user" u LEFT JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = ?`

/** Members of the workspace, optionally narrowed to one email (the `userName eq "…"` filter IdPs send before creating). */
export async function scimList(workspaceId: string, origin: string, email: string | null, startIndex: number, count: number) {
  const where = email ? `WHERE lower(u.email) = ? AND m.user_id IS NOT NULL` : `WHERE m.user_id IS NOT NULL`
  const binds = email ? [workspaceId, email.toLowerCase()] : [workspaceId]
  const { results } = await env.DB.prepare(`${SELECT} ${where} ORDER BY u."createdAt" LIMIT ? OFFSET ?`)
    .bind(...binds, count, Math.max(0, startIndex - 1))
    .all<Row>()
  const total = await env.DB.prepare(`SELECT count(*) AS n FROM workspace_members m JOIN "user" u ON u.id = m.user_id WHERE m.workspace_id = ? ${email ? "AND lower(u.email) = ?" : ""}`)
    .bind(...(email ? [workspaceId, email.toLowerCase()] : [workspaceId]))
    .first<{ n: number }>()
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total?.n ?? 0,
    startIndex,
    itemsPerPage: results.length,
    Resources: results.map((row) => resource(row, origin)),
  }
}

export async function scimGet(workspaceId: string, userId: string, origin: string) {
  const row = await env.DB.prepare(`${SELECT} WHERE u.id = ?`).bind(workspaceId, userId).first<Row>()
  return row ? resource(row, origin) : null
}

/** Adds the person (creating their account if the email is new) as a member. Returns the user id. */
export async function scimProvision(workspaceId: string, email: string, name: string): Promise<string> {
  const existing = await env.DB.prepare(`SELECT id FROM "user" WHERE lower(email) = ?`).bind(email.toLowerCase()).first<{ id: string }>()
  let id = existing?.id
  if (!id) {
    id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "isAnonymous") VALUES (?, ?, ?, 1, ?, ?, 0)`)
      .bind(id, name || email.split("@")[0], email.toLowerCase(), now, now)
      .run()
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')`).bind(workspaceId, id).run()
  await audit(workspaceId, null, "scim.provisioned", email)
  return id
}

/** Takes the person out of the workspace. Owners can't be deprovisioned by the IdP. */
export async function scimDeprovision(workspaceId: string, userId: string): Promise<string | null> {
  const member = await env.DB.prepare(`SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?`).bind(workspaceId, userId).first<{ role: string }>()
  if (!member) return null
  if (member.role === "owner") return "Owners can't be removed through SCIM; transfer ownership first."
  await env.DB.prepare(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?`).bind(workspaceId, userId).run()
  await audit(workspaceId, null, "scim.deprovisioned", userId)
  return null
}

export async function scimRename(userId: string, name: string) {
  await env.DB.prepare(`UPDATE "user" SET name = ?, "updatedAt" = ? WHERE id = ?`).bind(name, new Date().toISOString(), userId).run()
}
