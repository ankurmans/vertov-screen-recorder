import { createFileRoute } from "@tanstack/react-router"
import { json, optionsResponse } from "@/lib/api.server"
import * as tutorials from "@/lib/tutorials.server"
import { workspaceApi } from "@/lib/workspace-api.server"

export const Route = createFileRoute("/api/v1/tutorials/jobs/$id")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const job = await tutorials.jobFor(workspace.id, params.id, new URL(request.url).origin)
            return job ? json(job) : json({ error: "Job not found" }, 404)
          },
          { manage: true },
        ),
      OPTIONS: () => optionsResponse(),
    },
  },
})
