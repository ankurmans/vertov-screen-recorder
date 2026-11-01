import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { loomIdFrom, startLoomImport } from "@/lib/import.server"
import { userApi } from "@/lib/recordings.server"
import { getWorkspaceContext, libraryFullMessage } from "@/lib/workspace.server"

const importSchema = z.object({ urls: z.array(z.string().trim().max(500)).min(1).max(50) })

/** Brings public Loom videos into the signed-in user's library. */
export const Route = createFileRoute("/api/import")({
  server: {
    handlers: {
      POST: ({ request }) =>
        userApi(request, async (user) => {
          const parsed = importSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Paste up to 50 Loom links" }, 400)
          const ids = [...new Set(parsed.data.urls.map(loomIdFrom).filter((id): id is string => id !== null))]
          if (ids.length === 0) return json({ error: "Those don't look like Loom links" }, 400)
          const { workspace } = await getWorkspaceContext(request, user)
          const full = await libraryFullMessage(workspace)
          if (full) return json({ error: full, code: "library_full" }, 402)
          const results = []
          for (const loomId of ids) {
            try {
              results.push({ loomId, ...(await startLoomImport(user.sub, workspace, loomId)) })
            } catch (error) {
              results.push({ loomId, error: error instanceof Error ? error.message : "Import failed" })
            }
          }
          return json({ results })
        }),
    },
  },
})
