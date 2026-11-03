import { createFileRoute } from "@tanstack/react-router"
import { json, optionsResponse } from "@/lib/api.server"
import * as tutorials from "@/lib/tutorials.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/** GET lists this workspace's tutorial jobs and whether a runner is connected; POST queues one from a registered recipe. */
export const Route = createFileRoute("/api/v1/tutorials/jobs")({
  server: {
    handlers: {
      GET: ({ request }) => workspaceApi(request, async (_user, { workspace }) => json(await tutorials.jobsFor(workspace.id, new URL(request.url).origin)), { manage: true }),
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const result = await tutorials.startJob(user, workspace, await request.json().catch(() => null))
            return result.ok ? json(result.job, 201) : json({ error: result.error }, result.status)
          },
          { manage: true },
        ),
      OPTIONS: () => optionsResponse(),
    },
  },
})
