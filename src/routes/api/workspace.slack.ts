import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { workspaces } from "@/db/schema"
import { json } from "@/lib/api.server"
import { isSlackWebhook, maskWebhook } from "@/lib/slack.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const putSchema = z.object({ webhook: z.string().trim().max(300) })

/** The workspace's Slack incoming webhook. It is stored once and only ever shown masked. */
export const Route = createFileRoute("/api/workspace/slack")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(request, async (_user, { workspace }) =>
          json({ connected: Boolean(workspace.slackWebhook), masked: workspace.slackWebhook ? maskWebhook(workspace.slackWebhook) : null }),
        ),
      PUT: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const parsed = putSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success || !isSlackWebhook(parsed.data.webhook)) {
              return json({ error: "That isn't a Slack incoming webhook. It should start with https://hooks.slack.com/" }, 400)
            }
            await db.update(workspaces).set({ slackWebhook: parsed.data.webhook }).where(eq(workspaces.id, workspace.id))
            return json({ connected: true, masked: maskWebhook(parsed.data.webhook) })
          },
          { manage: true },
        ),
      DELETE: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            await db.update(workspaces).set({ slackWebhook: null }).where(eq(workspaces.id, workspace.id))
            return json({ connected: false, masked: null })
          },
          { manage: true },
        ),
    },
  },
})
