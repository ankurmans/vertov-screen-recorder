import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { commandResults } from "@/lib/commands.server"
import { workspaceApi } from "@/lib/workspace-api.server"

export const Route = createFileRoute("/api/commands")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(request, async (user, context) => {
          const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? ""
          return json(await commandResults(user, context, query), { headers: { "cache-control": "private, no-store" } })
        }),
    },
  },
})
