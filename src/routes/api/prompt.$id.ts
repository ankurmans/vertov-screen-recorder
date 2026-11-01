import { createFileRoute } from "@tanstack/react-router"
import { denyUnlessViewable } from "@/lib/access.server"
import { agentPrompt } from "@/lib/agent.server"
import { withCors } from "@/lib/api.server"
import { getUploadById } from "@/lib/uploads.server"

/** The video as a Markdown brief for an AI agent, for anyone who can watch it ("Copy for an AI agent"). */
export const Route = createFileRoute("/api/prompt/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        if (!upload) return withCors(new Response("Not found", { status: 404 }))
        return withCors(
          new Response(await agentPrompt(upload, new URL(request.url).origin), {
            headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "private, max-age=0" },
          }),
        )
      },
    },
  },
})
