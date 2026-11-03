import { createFileRoute } from "@tanstack/react-router"
import { json, optionsResponse } from "@/lib/api.server"
import * as tutorials from "@/lib/tutorials.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/** Queued jobs cancel at once; a running job is told to stop at its runner's next progress report. */
export const Route = createFileRoute("/api/v1/tutorials/jobs/$id/cancel")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const state = await tutorials.cancel(workspace.id, params.id)
            return state === "not_found" ? json({ error: "Job not found" }, 404) : json({ state })
          },
          { manage: true },
        ),
      OPTIONS: () => optionsResponse(),
    },
  },
})
