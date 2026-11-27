import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { watchLater } from "@/db/schema"
import { denyUnlessViewable } from "@/lib/access.server"
import { json } from "@/lib/api.server"
import { userApi } from "@/lib/recordings.server"
import { getUploadById } from "@/lib/uploads.server"

/** A signed-in viewer's Watch later list: GET says whether this video is on it, POST adds, DELETE removes. */
export const Route = createFileRoute("/api/watch-later/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        userApi(request, async (user) => {
          const row = await db.query.watchLater.findFirst({
            where: and(eq(watchLater.userId, user.sub), eq(watchLater.uploadId, params.id)),
          })
          return json({ saved: Boolean(row) })
        }),
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await getUploadById(params.id)
          if (!upload || upload.mediaType !== "video") return json({ error: "Not found" }, 404)
          const denied = await denyUnlessViewable(upload, request)
          if (denied) return denied
          await db.insert(watchLater).values({ userId: user.sub, uploadId: upload.id }).onConflictDoNothing()
          return json({ saved: true })
        }),
      DELETE: ({ request, params }) =>
        userApi(request, async (user) => {
          await db.delete(watchLater).where(and(eq(watchLater.userId, user.sub), eq(watchLater.uploadId, params.id)))
          return json({ saved: false })
        }),
    },
  },
})
