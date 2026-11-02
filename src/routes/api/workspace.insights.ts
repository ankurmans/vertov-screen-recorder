import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { workspaceInsights, workspaceInsightsCsv } from "@/lib/analytics.server"
import { workspaceApi } from "@/lib/workspace-api.server"

export const Route = createFileRoute("/api/workspace/insights")({
  server: {
    handlers: {
      GET: ({ request }) => workspaceApi(request, async (_user, { workspace }) => {
        if (new URL(request.url).searchParams.get("format") === "csv") return workspaceInsightsCsv(workspace.id)
        return json(await workspaceInsights(workspace.id), { headers: { "cache-control": "private, no-store" } })
      }, { manage: true }),
    },
  },
})
