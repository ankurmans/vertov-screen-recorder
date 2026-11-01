import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { userApi } from "@/lib/recordings.server"
import { roleIn, workspaceCookie } from "@/lib/workspace.server"

const switchSchema = z.object({ id: z.string().min(1).max(80) })

/** Makes another of the user's workspaces the active one. */
export const Route = createFileRoute("/api/workspace/switch")({
  server: {
    handlers: {
      POST: ({ request }) =>
        userApi(request, async (user) => {
          const parsed = switchSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success || !(await roleIn(parsed.data.id, user.sub))) return json({ error: "Workspace not found" }, 404)
          return json({ ok: true }, { headers: { "set-cookie": workspaceCookie(parsed.data.id, request) } })
        }),
    },
  },
})
