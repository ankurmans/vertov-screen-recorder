import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { sendTest } from "@/lib/slack.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/** Posts a hello to the saved Slack webhook so the owner can see it works. */
export const Route = createFileRoute("/api/workspace/slack/test")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            if (!workspace.slackWebhook) return json({ error: "Save a webhook first." }, 400)
            const ok = await sendTest(workspace.slackWebhook, workspace.name)
            return ok ? json({ ok: true }) : json({ error: "Slack didn't accept that webhook. Check it and try again." }, 502)
          },
          { manage: true },
        ),
    },
  },
})
