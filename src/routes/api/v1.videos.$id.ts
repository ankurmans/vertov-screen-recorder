import { createFileRoute } from "@tanstack/react-router"
import { agentPrompt, memberCanSee, videoForAgent } from "@/lib/agent.server"
import { json, optionsResponse, withCors } from "@/lib/api.server"
import { ownedUpload } from "@/lib/recordings.server"
import { getUploadById } from "@/lib/uploads.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/**
 * One video for an agent. JSON by default (with the timestamped transcript);
 * ?format=prompt returns the whole video as a Markdown prompt to hand to another agent.
 * AI documents go only to the recorder or a workspace manager (ownedUpload); other members see which kinds exist.
 */
export const Route = createFileRoute("/api/v1/videos/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const upload = await getUploadById(params.id)
          if (!upload || !memberCanSee(upload, user, workspace.id, role)) return json({ error: "Video not found" }, 404)
          const origin = new URL(request.url).origin
          if (new URL(request.url).searchParams.get("format") === "prompt") {
            return withCors(new Response(await agentPrompt(upload, origin), { headers: { "content-type": "text/markdown; charset=utf-8" } }))
          }
          const { aiDocs, ...video } = await videoForAgent(upload, origin, true)
          const aiDocsWritten = Object.keys(aiDocs ?? {})
          return json((await ownedUpload(upload.id, user)) ? { ...video, aiDocs, aiDocsWritten } : { ...video, aiDocsWritten })
        }),
      OPTIONS: () => optionsResponse(),
    },
  },
})
