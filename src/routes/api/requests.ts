import { createFileRoute } from "@tanstack/react-router"
import { desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { videoRequests } from "@/db/schema"
import { json } from "@/lib/api.server"
import { REQUEST_DAYS } from "@/lib/requests.server"
import { userApi } from "@/lib/recordings.server"
import { getWorkspaceContext, newId } from "@/lib/workspace.server"

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().max(500).nullable().optional(),
})

export const Route = createFileRoute("/api/requests")({
  server: {
    handlers: {
      GET: ({ request }) =>
        userApi(request, async (user) => {
          const { workspace } = await getWorkspaceContext(request, user)
          const rows = await db
            .select({
              id: videoRequests.id,
              title: videoRequests.title,
              createdAt: videoRequests.createdAt,
              expiresAt: videoRequests.expiresAt,
              revokedAt: videoRequests.revokedAt,
              responses: sql<number>`(select count(*) from uploads u where u.request_id = video_requests.id)`,
            })
            .from(videoRequests)
            .where(eq(videoRequests.workspaceId, workspace.id))
            .orderBy(desc(videoRequests.createdAt))
            .limit(30)
          return json({ requests: rows })
        }),
      POST: ({ request }) =>
        userApi(request, async (user) => {
          const parsed = createSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Give the request a title." }, 400)
          const { workspace } = await getWorkspaceContext(request, user)
          const id = newId("req")
          const expiresAt = new Date(Date.now() + REQUEST_DAYS * 86_400_000).toISOString()
          await db.insert(videoRequests).values({
            id,
            workspaceId: workspace.id,
            createdBy: user.sub,
            title: parsed.data.title,
            message: parsed.data.message || null,
            expiresAt,
          })
          return json({ id, url: `${new URL(request.url).origin}/request/${id}` }, 201)
        }),
    },
  },
})
