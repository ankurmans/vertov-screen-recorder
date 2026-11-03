import { createFileRoute } from "@tanstack/react-router"
import { json, optionsResponse } from "@/lib/api.server"
import * as tutorials from "@/lib/tutorials.server"
import { workspaceApi } from "@/lib/workspace-api.server"

import { completeSchema } from "@/lib/tutorials/jobs"

/** Runner call (complete). Only the runner holding the job's claim is accepted. */
export const Route = createFileRoute("/api/v1/tutorials/jobs/$id/complete")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const body = completeSchema.safeParse(await request.json().catch(() => null))
            if (!body.success) return json({ error: "Invalid body" }, 400)
            const result = await tutorials.complete(workspace.id, params.id, body.data.runnerId, body.data, new URL(request.url).origin)
            return result.ok ? json(result.job) : json({ error: result.error }, result.status)
          },
          { manage: true },
        ),
      OPTIONS: () => optionsResponse(),
    },
  },
})
