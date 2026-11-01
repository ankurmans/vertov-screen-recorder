import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { workspaceMembers } from "@/db/schema"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { listMembers, workspaceApi } from "@/lib/workspace-api.server"

const schema = z.object({ userId: z.string().min(1).max(80) })

/** Hands the workspace to another member: they become the owner and the sender steps down to admin. Owners only. */
export const Route = createFileRoute("/api/workspace/transfer")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          if (role !== "owner") return json({ error: "Only an owner can transfer ownership" }, 403)
          const parsed = schema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Pick a member" }, 400)
          if (parsed.data.userId === user.sub) return json({ error: "You already own this workspace" }, 400)
          const target = (await listMembers(workspace.id)).find((member) => member.userId === parsed.data.userId)
          if (!target) return json({ error: "Not a member" }, 404)
          await db.batch([
            db.update(workspaceMembers).set({ role: "owner" }).where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, target.userId))),
            db.update(workspaceMembers).set({ role: "admin" }).where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, user.sub))),
          ])
          await audit(workspace.id, user.sub, "workspace.transferred", target.email ?? target.name)
          return json({ ok: true })
        }),
    },
  },
})
