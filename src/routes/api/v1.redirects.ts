import { createFileRoute } from "@tanstack/react-router"
import { and, eq, like } from "drizzle-orm"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import { json } from "@/lib/api.server"
import { loomIdFrom } from "@/lib/import.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/** Loom videos this workspace has copied in, so the extension can send old Loom links to the copies. */
export const Route = createFileRoute("/api/v1/redirects")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(request, async (_user, { workspace }) => {
          const rows = await db
            .select({ id: uploads.id, sourceUrl: uploads.sourceUrl })
            .from(uploads)
            .where(and(eq(uploads.workspaceId, workspace.id), eq(uploads.status, "ready"), like(uploads.sourceUrl, "https://www.loom.com/%")))
          const origin = new URL(request.url).origin
          return json({
            redirects: rows.flatMap((row) => {
              const loomId = row.sourceUrl ? loomIdFrom(row.sourceUrl) : null
              return loomId ? [{ loomId, url: `${origin}/${row.id}` }] : []
            }),
          })
        }),
    },
  },
})
