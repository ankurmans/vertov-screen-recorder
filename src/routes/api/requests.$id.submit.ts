import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { uploads, workspaces } from "@/db/schema"
import { notify } from "@/lib/slack.server"
import { json } from "@/lib/api.server"
import { allow, clientIp } from "@/lib/rate-limit.server"
import { liveRequest, notifyRequester } from "@/lib/requests.server"
import { userApi } from "@/lib/recordings.server"
import { getUploadById } from "@/lib/uploads.server"
import { libraryFullMessage } from "@/lib/workspace.server"

const schema = z.object({ uploadId: z.string().min(1).max(64), name: z.string().trim().max(80).nullable().optional() })

/** Hands a finished recording to whoever asked for it: it moves into their workspace and they own it. */
export const Route = createFileRoute("/api/requests/$id/submit")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const parsed = schema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Invalid submission" }, 400)
          if (!(await allow(`submit:${clientIp(request)}`, 20, 3600))) {
            return json({ error: "Too many videos from this network. Try again later." }, 429)
          }
          const live = await liveRequest(params.id)
          if (!live) return json({ error: "This request has closed." }, 410)
          const upload = await getUploadById(parsed.data.uploadId)
          if (!upload || upload.ownerId !== user.sub || upload.requestId) return json({ error: "Not found" }, 404)
          const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, live.request.workspaceId) })
          if (!workspace) return json({ error: "This request has closed." }, 410)
          const full = await libraryFullMessage(workspace)
          if (full) return json({ error: "The person who asked can't take more videos right now." }, 402)
          const who = parsed.data.name || "Guest"
          await db
            .update(uploads)
            .set({
              ownerId: live.request.createdBy,
              workspaceId: live.request.workspaceId,
              spaceId: live.request.spaceId,
              requestId: live.request.id,
              title: `${live.request.title} (${who})`,
              visibility: workspace.defaultVisibility,
            })
            .where(eq(uploads.id, upload.id))
          await notifyRequester(live.request, who, upload.id, new URL(request.url).origin).catch((error) =>
            console.error(JSON.stringify({ message: "Request email failed", error: (error as Error).message })),
          )
          await notify(live.request.workspaceId, `${who} sent a video for "${live.request.title}"\n${new URL(request.url).origin}/${upload.id}`)
          return json({ ok: true })
        }),
    },
  },
})
