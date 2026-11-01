import { createFileRoute } from "@tanstack/react-router"
import { auditCsv, listAudit } from "@/lib/audit.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/** The activity log as a spreadsheet-ready CSV download. */
export const Route = createFileRoute("/api/workspace/audit/csv")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) =>
            new Response(auditCsv(await listAudit(workspace.id, 5000)), {
              headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="activity-log.csv"' },
            }),
          { manage: true },
        ),
    },
  },
})
