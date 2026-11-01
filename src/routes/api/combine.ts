import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { MAX_STITCH_CLIPS, startStitch } from "@/lib/stitch.server"
import { libraryFullMessage } from "@/lib/workspace.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const combineSchema = z.object({
  ids: z.array(z.string().regex(/^[a-f0-9]{8}$/)).min(2).max(MAX_STITCH_CLIPS),
  title: z.string().trim().max(200).nullable().optional(),
})

/** Joins videos, in the order given, into one new video. The originals are untouched. */
export const Route = createFileRoute("/api/combine")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const parsed = combineSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: `Pick 2 to ${MAX_STITCH_CLIPS} videos` }, 400)
          const full = await libraryFullMessage(workspace)
          if (full) return json({ error: full, code: "library_full" }, 402)
          const result = await startStitch(user, workspace, role, parsed.data.ids, parsed.data.title ?? null)
          if ("error" in result) return json({ error: result.error }, 400)
          return json({ id: result.id, url: `${new URL(request.url).origin}/${result.id}` }, 202)
        }),
    },
  },
})
