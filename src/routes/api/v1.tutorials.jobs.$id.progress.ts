import { createFileRoute } from "@tanstack/react-router"
import { json, optionsResponse } from "@/lib/api.server"
import * as tutorials from "@/lib/tutorials.server"
import { workspaceApi } from "@/lib/workspace-api.server"

import { progressSchema } from "@/lib/tutorials/jobs"

/** Runner call (progress). Only the runner holding the job's claim is accepted. */
export const Route = createFileRoute("/api/v1/tutorials/jobs/$id/progress")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const body = progressSchema.safeParse(await request.json().catch(() => null))
            if (!body.success) return json({ error: "Invalid body" }, 400)
            const result = await tutorials.progress(workspace.id, params.id, body.data.runnerId, body.data)
            return result.ok ? json({ cancel: result.cancel }) : json({ error: result.reason }, result.reason === "not_found" ? 404 : 409)
          },
          { manage: true },
        ),
      OPTIONS: () => optionsResponse(),
    },
  },
})
