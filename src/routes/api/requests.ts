import { createFileRoute } from "@tanstack/react-router"
import { and, desc, eq, isNull, not, notLike, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { videoRequests } from "@/db/schema"
import { isUnclaimedGuest } from "@/lib/access.server"
import { json } from "@/lib/api.server"
import { captureServer } from "@/lib/posthog.server"
import { KEPT_OPEN_UNTIL } from "@/lib/request-link"
import { REQUEST_DAYS } from "@/lib/requests.server"
import { userApi } from "@/lib/recordings.server"
import { getWorkspaceContext, newId } from "@/lib/workspace.server"

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().max(500).nullable().optional(),
  keepOpen: z.boolean().optional(),
})

export const Route = createFileRoute("/api/requests")({
  server: {
    handlers: {
      GET: ({ request }) =>
        userApi(request, async (user) => {
          const { workspace } = await getWorkspaceContext(request, user)
          const list = () =>
            db
              .select({
                id: videoRequests.id,
                title: videoRequests.title,
                createdAt: videoRequests.createdAt,
                expiresAt: videoRequests.expiresAt,
                revokedAt: videoRequests.revokedAt,
                responses: sql<number>`(select count(*) from uploads u where u.request_id = video_requests.id)`,
              })
              .from(videoRequests)
          // Reply links are left out: their IDs and titles name videos other members may not see. Each is closed from its video.
          const mine = and(eq(videoRequests.workspaceId, workspace.id), notLike(videoRequests.id, "reply%"))!
          const open = and(isNull(videoRequests.revokedAt), eq(videoRequests.expiresAt, KEPT_OPEN_UNTIL))!
          // Every link kept open is listed, first: they never expire, so none may drop off the list where it is closed.
          const kept = await list().where(and(mine, open)).orderBy(desc(videoRequests.createdAt))
          const others = await list().where(and(mine, not(open))).orderBy(desc(videoRequests.createdAt)).limit(30)
          const rows = [...kept, ...others]
          return json({ requests: rows })
        }),
      POST: ({ request }) =>
        userApi(request, async (user) => {
          const parsed = createSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Give the request a title." }, 400)
          const keepOpen = parsed.data.keepOpen === true
          // A link that never expires needs an owner who can come back to close it.
          if (keepOpen && (await isUnclaimedGuest(user.sub))) return json({ error: "Save your account to keep a link open." }, 403)
          const { workspace } = await getWorkspaceContext(request, user)
          const id = newId("req")
          const expiresAt = keepOpen ? KEPT_OPEN_UNTIL : new Date(Date.now() + REQUEST_DAYS * 86_400_000).toISOString()
          await db.insert(videoRequests).values({
            id,
            workspaceId: workspace.id,
            createdBy: user.sub,
            title: parsed.data.title,
            message: parsed.data.message || null,
            expiresAt,
          })
          captureServer("request_created", user.sub, { keep_open: keepOpen })
          return json({ id, url: `${new URL(request.url).origin}/request/${id}` }, 201)
        }),
    },
  },
})
