import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workspaceInvites, workspaceMembers } from "@/db/schema"
import { json } from "@/lib/api.server"
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
            await db.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId: user.sub, role: invite.role }).onConflictDoNothing()
          }
          return json({ ok: true }, { headers: { "set-cookie": workspaceCookie(invite.workspaceId, request) } })
        }),
    },
  },
})
