import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { createPlaylist, listPlaylists } from "@/lib/playlists.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const createSchema = z.object({ title: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional() })

/** The active workspace's playlists. Any member can make one. */
export const Route = createFileRoute("/api/playlists")({
  server: {
    handlers: {
      GET: ({ request }) => workspaceApi(request, async (_user, { workspace }) => json({ playlists: await listPlaylists(workspace.id) })),
      POST: ({ request }) =>
        workspaceApi(request, async (user, { workspace }) => {
          const parsed = createSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Give the playlist a title" }, 400)
          return json({ playlist: await createPlaylist(workspace.id, user.sub, parsed.data) }, 201)
        }),
    },
  },
})
