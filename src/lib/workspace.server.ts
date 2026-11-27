import { and, asc, eq, sql } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { Workspace } from "@/db/schema"
import type { SessionUser } from "@/lib/auth.server"
import type { Role } from "@/lib/plans"
import { db } from "@/db"
import { workspaceInvites, workspaceMembers, workspaces } from "@/db/schema"
import { attachReferral } from "@/lib/referrals.server"
import { canManage } from "@/lib/plans"

/** This edition has no plans or limits. */
export const isHosted = () => false

export interface Membership {
  id: string
  name: string
  role: Role
}

export interface WorkspaceContext {
  workspace: Workspace
  role: Role
  memberships: Array<Membership>
}

const COOKIE = "rl_ws"

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}

export function workspaceCookie(id: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  return `${COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`

async function listMemberships(userId: string): Promise<Array<Membership>> {
  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
  return rows.map((row) => ({ ...row, role: row.role as Role }))
}

/** A new account's own workspace, so recording works before anyone thinks about teams. */
async function createPersonalWorkspace(user: SessionUser): Promise<Membership> {
  const id = `p_${user.sub}`
  const named = user.name && user.name !== user.email && user.name !== "Passkey user" ? user.name : user.email?.split("@")[0]
  const name = named ? `${named}'s workspace` : "My workspace"
  await db.batch([
    db.insert(workspaces).values({ id, name, createdBy: user.sub }).onConflictDoNothing(),
    db.insert(workspaceMembers).values({ workspaceId: id, userId: user.sub, role: "owner" }).onConflictDoNothing(),
  ])
  return { id, name, role: "owner" }
}

/** The workspace this request acts in: the one picked last (cookie), else the first the user joined. */
export async function getWorkspaceContext(request: Request, user: SessionUser): Promise<WorkspaceContext> {
  let memberships = await listMemberships(user.sub)
  if (memberships.length === 0) {
    memberships = [await createPersonalWorkspace(user)]
    // A friend arriving from a ?ref= link is recorded when their first workspace is made; it pays out at their first recording.
    if (isHosted()) await attachReferral(request, user.sub)
  }
  // An API key is pinned to its workspace (auth only accepts it while its user is still a member).
  const wanted = user.workspaceId ?? readCookie(request, COOKIE)
  const active = memberships.find((membership) => membership.id === wanted) ?? memberships[0]
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, active.id) })
  if (!workspace) throw new Error(`workspace ${active.id} missing`)
  return { workspace, role: active.role, memberships }
}

/** Starts only need the active workspace and its membership. Keep the same selection and first-use fallback. */
export async function getRecordingWorkspace(request: Request, user: SessionUser): Promise<Pick<WorkspaceContext, "workspace" | "role">> {
  const wanted = user.workspaceId ?? readCookie(request, COOKIE)
  const active = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.sub))
    .orderBy(sql`case when ${workspaces.id} = ${wanted} then 0 else 1 end`, asc(workspaceMembers.createdAt))
    .get()
  return active ? { workspace: active.workspace, role: active.role as Role } : getWorkspaceContext(request, user)
}

export async function roleIn(workspaceId: string | null | undefined, userId: string): Promise<Role | null> {
  if (!workspaceId) return null
  const row = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  })
  return (row?.role as Role | undefined) ?? null
}

/** An invite link is only as good as its issuer: it stops working once whoever created it can no longer manage the workspace. */
export async function inviteUsable(invite: { workspaceId: string; createdBy: string; revokedAt: string | null; expiresAt: string }): Promise<boolean> {
  if (invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now()) return false
  return canManage(await roleIn(invite.workspaceId, invite.createdBy))
}

/** Revokes the invite links a person issued to a workspace; called whenever they leave it, are removed, or stop managing it. */
export async function revokeInvitesBy(workspaceId: string, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE workspace_invites SET revoked_at = ? WHERE workspace_id = ? AND created_by = ? AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), workspaceId, userId)
    .run()
}

/** A live invite's workspace name and role, and whether this user is already in it; null when expired, revoked or its issuer no longer manages the workspace. */
export async function inviteInfo(token: string, userId: string) {
  const invite = await db.query.workspaceInvites.findFirst({ where: eq(workspaceInvites.id, token) })
  if (!invite || !(await inviteUsable(invite))) return null
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, invite.workspaceId) })
  return {
    name: workspace?.name ?? "a workspace",
    role: invite.role,
    already: Boolean(await roleIn(invite.workspaceId, userId)),
  }
}

/** No library limit, length rule or AI allowance in this edition. */
export const usageOf = async (_workspace: Workspace) => ({ usedHours: 0, limitHours: Number.POSITIVE_INFINITY, full: false })
export const libraryFullResponse = async (_workspace: Workspace, _role?: Role): Promise<Response | null> => null
export const libraryFullMessage = async (_workspace: Workspace): Promise<string | null> => null
export const lengthRuleFor = async (_workspace: Workspace): Promise<{ capSeconds: number | null; enforce: boolean }> => ({ capSeconds: null, enforce: false })
export const takeAi = async (_workspace: Workspace | null): Promise<boolean> => true
export const startTrialFor = async (_userId: string): Promise<void> => {}

export const toPublicWorkspace = (workspace: Workspace) => ({
  id: workspace.id,
  name: workspace.name,
  defaultVisibility: workspace.defaultVisibility,
})
export type PublicWorkspace = ReturnType<typeof toPublicWorkspace>
