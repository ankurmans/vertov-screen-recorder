import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { workspaceMembers } from "@/db/schema"
import { json } from "@/lib/api.server"
import { canManage } from "@/lib/plans"
import { listMembers, workspaceApi } from "@/lib/workspace-api.server"

const roleSchema = z.object({ role: z.enum(["owner", "admin", "member"]) })

/**
 * Change someone's role, or remove them. Admins manage members; only owners hand out or take away
 * ownership; a workspace always keeps at least one owner. Anyone may remove themselves (leave).
 */
export const Route = createFileRoute("/api/workspace/members/$userId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        workspaceApi(
          request,
          async (_user, { workspace, role }) => {
            const parsed = roleSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Invalid role" }, 400)
            const members = await listMembers(workspace.id)
            const target = members.find((member) => member.userId === params.userId)
            if (!target) return json({ error: "Not a member" }, 404)
            if ((target.role === "owner" || parsed.data.role === "owner") && role !== "owner") {
              return json({ error: "Only an owner can change ownership" }, 403)
            }
            if (target.role === "owner" && parsed.data.role !== "owner" && members.filter((member) => member.role === "owner").length === 1) {
              return json({ error: "A workspace needs at least one owner" }, 400)
            }
            await db
              .update(workspaceMembers)
              .set({ role: parsed.data.role })
              .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, params.userId)))
            return json({ ok: true })
          },
          { manage: true },
        ),
      DELETE: ({ request, params }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const self = params.userId === user.sub
          if (!self && !canManage(role)) return json({ error: "Only workspace owners and admins can do that" }, 403)
          const members = await listMembers(workspace.id)
          const target = members.find((member) => member.userId === params.userId)
          if (!target) return json({ error: "Not a member" }, 404)
          if (target.role === "owner" && !self && role !== "owner") return json({ error: "Only an owner can remove an owner" }, 403)
          if (target.role === "owner" && members.filter((member) => member.role === "owner").length === 1) {
            return json({ error: "Make someone else an owner first" }, 400)
          }
          // Their videos stay in the workspace; an admin can still manage them.
          await db
            .delete(workspaceMembers)
            .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, params.userId)))
          return json({ ok: true })
        }),
    },
  },
})
