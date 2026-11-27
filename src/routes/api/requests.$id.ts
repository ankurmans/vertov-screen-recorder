import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { videoRequests } from "@/db/schema"
import { json } from "@/lib/api.server"
import { canManage } from "@/lib/plans"
import { userApi } from "@/lib/recordings.server"
import { roleIn } from "@/lib/workspace.server"

/** Closes a request link. Videos already sent in stay in the library. */
export const Route = createFileRoute("/api/requests/$id")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        userApi(request, async (user) => {
          const row = await db.query.videoRequests.findFirst({ where: eq(videoRequests.id, params.id) })
          if (!row) return json({ error: "Not found" }, 404)
          if (row.createdBy !== user.sub && !canManage(await roleIn(row.workspaceId, user.sub))) {
            return json({ error: "Not found" }, 404)
          }
          await db.update(videoRequests).set({ revokedAt: new Date().toISOString() }).where(eq(videoRequests.id, row.id))
          return json({ ok: true })
        }),
    },
  },
})
