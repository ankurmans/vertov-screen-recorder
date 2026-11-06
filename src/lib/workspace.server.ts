import { and, asc, eq, sql } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { Workspace } from "@/db/schema"
import type { SessionUser } from "@/lib/auth.server"
import type { PlanId, Role } from "@/lib/plans"
import { db } from "@/db"
import { uploads, workspaceInvites, workspaceMembers, workspaces } from "@/db/schema"
import { BYTES_PER_HOUR, PLANS, isPlanId, planHours } from "@/lib/plans"

/**
 * The hosted service enforces plans and retention; a self-hosted install (HOSTED unset) has
 * no limits at all, because the person running it pays Cloudflare directly.
 */
export const isHosted = () => Reflect.get(env, "HOSTED") === "1"

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
  if (memberships.length === 0) memberships = [await createPersonalWorkspace(user)]
  // An API key is pinned to its workspace (auth only accepts it while its user is still a member).
  const wanted = user.workspaceId ?? readCookie(request, COOKIE)
  const active = memberships.find((membership) => membership.id === wanted) ?? memberships[0]
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, active.id) })
  if (!workspace) throw new Error(`workspace ${active.id} missing`)
  return { workspace, role: active.role, memberships }
}

export async function roleIn(workspaceId: string | null | undefined, userId: string): Promise<Role | null> {
  if (!workspaceId) return null
  const row = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  })
  return (row?.role as Role | undefined) ?? null
}

/** A live invite's workspace name and role, and whether this user is already in it; null when expired or revoked. */
export async function inviteInfo(token: string, userId: string) {
  const invite = await db.query.workspaceInvites.findFirst({ where: eq(workspaceInvites.id, token) })
  if (!invite || invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now()) return null
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, invite.workspaceId) })
  return {
    name: workspace?.name ?? "a workspace",
    role: invite.role,
    already: Boolean(await roleIn(invite.workspaceId, userId)),
  }
}

export function planOf(workspace: Pick<Workspace, "plan">): PlanId {
  return isPlanId(workspace.plan) ? workspace.plan : "free"
}

/** Whether AI titles, summaries and chapters run for this workspace's videos. */
export function aiEnabled(workspace: Pick<Workspace, "plan"> | null): boolean {
  if (!isHosted()) return true
  return workspace ? PLANS[planOf(workspace)].ai : false
}

export interface Usage {
  usedHours: number
  /** Infinity when self-hosted. */
  limitHours: number
  full: boolean
}

export async function usageOf(workspace: Workspace): Promise<Usage> {
  const row = await db
    .select({
      seconds: sql<number>`coalesce(sum(max(coalesce(${uploads.duration}, 0), ${uploads.size} * 3600.0 / ${BYTES_PER_HOUR})), 0)`,
    })
    .from(uploads)
    .where(and(eq(uploads.workspaceId, workspace.id), sql`${uploads.deletedAt} is null`, sql`${uploads.status} <> 'failed'`))
  const usedHours = Number(row[0]?.seconds ?? 0) / 3600
  const limitHours = isHosted() ? planHours(planOf(workspace), workspace.extraBlocks) : Number.POSITIVE_INFINITY
  return { usedHours, limitHours, full: usedHours >= limitHours }
}

/** Null when a new recording, upload or import may start; otherwise the reason it can't. */
export async function libraryFullMessage(workspace: Workspace): Promise<string | null> {
  const usage = await usageOf(workspace)
  if (!usage.full) return null
  return `This workspace's library is full (${Math.round(usage.limitHours)} hours). Add hours, upgrade, or delete or download old videos to make room. Nothing you have is deleted.`
}

export const toPublicWorkspace = (workspace: Workspace) => ({
  id: workspace.id,
  name: workspace.name,
  plan: planOf(workspace),
  planInterval: workspace.planInterval,
  planStatus: workspace.planStatus,
  planPeriodEnd: workspace.planPeriodEnd,
  extraBlocks: workspace.extraBlocks,
  defaultVisibility: workspace.defaultVisibility,
  brandColor: workspace.brandColor,
  coverStyle: workspace.coverStyle,
  hasLogo: Boolean(workspace.brandLogoKey),
})
export type PublicWorkspace = ReturnType<typeof toPublicWorkspace>
