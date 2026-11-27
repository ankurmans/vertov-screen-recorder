import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { db } from "@/db"
import { videoRequests } from "@/db/schema"
import { isUnclaimedGuest } from "@/lib/access.server"
import { json } from "@/lib/api.server"
import { captureServer } from "@/lib/posthog.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"
import { KEPT_OPEN_UNTIL, replyIdRange } from "@/lib/request-link"
import { closeReplyRequests, openReplyRequest, replyTitle } from "@/lib/requests.server"
import { newId } from "@/lib/workspace.server"

const schema = z.object({ on: z.boolean() })

/** "Ask for a video reply": the sender turns it on or off for one video. Replies arrive in their own library. */
export const Route = createFileRoute("/api/recordings/$id/reply")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        userApi(request, async (user) => {
          const parsed = schema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Invalid request" }, 400)
          const upload = await ownedUpload(params.id, user)
          if (!upload || upload.deletedAt || upload.mediaType !== "video" || !upload.workspaceId) return json({ error: "Not found" }, 404)
          if (!parsed.data.on) {
            await closeReplyRequests(upload.id)
            return json({ replyRequestId: null })
          }
          // The link stays open until it is turned off, so its owner must be able to come back.
          if (await isUnclaimedGuest(user.sub)) return json({ error: "Save your account to ask for replies." }, 403)
          const open = await openReplyRequest(upload.id)
          if (open) return json({ replyRequestId: open })
          // A full link is replaced, so turning replies on always leaves a link that takes them.
          await closeReplyRequests(upload.id)
          const id = `${replyIdRange(upload.id)[0]}${newId("r").slice(2)}`
          await db.insert(videoRequests).values({
            id,
            workspaceId: upload.workspaceId,
            createdBy: user.sub,
            title: replyTitle(upload.title),
            expiresAt: KEPT_OPEN_UNTIL,
          })
          captureServer("reply_requested", user.sub)
          return json({ replyRequestId: id })
        }, { sessionOnly: true }),
    },
  },
})
