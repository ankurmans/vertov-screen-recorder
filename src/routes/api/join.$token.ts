import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workspaceInvites, workspaceMembers, workspaces } from "@/db/schema"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { domainProblem } from "@/lib/security.server"
import { userApi } from "@/lib/recordings.server"
import { roleIn, workspaceCookie } from "@/lib/workspace.server"

/** Accepts an invite link: join (or keep your current role if you're already in), then switch to it. */
export const Route = createFileRoute("/api/join/$token")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const invite = await db.query.workspaceInvites.findFirst({ where: eq(workspaceInvites.id, params.token) })
          if (!invite || invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now()) {
            return json({ error: "This invite link has expired. Ask for a new one." }, 410)
          }
          if (!(await roleIn(invite.workspaceId, user.sub))) {
            const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, invite.workspaceId) })
            const problem = workspace ? domainProblem(workspace, user.email) : null
            if (problem) return json({ error: problem }, 403)
            await audit(invite.workspaceId, user.sub, "member.joined", user.email ?? user.name, `as ${invite.role}`)
            await db.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId: user.sub, role: invite.role }).onConflictDoNothing()
          }
          return json({ ok: true }, { headers: { "set-cookie": workspaceCookie(invite.workspaceId, request) } })
        }),
    },
  },
})
