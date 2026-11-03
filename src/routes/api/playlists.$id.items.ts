import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { addToPlaylist, canEditPlaylist, removeFromPlaylist, workspacePlaylist } from "@/lib/playlists.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const itemSchema = z.object({ uploadId: z.string().min(1).max(64) })

/** Add a video to (POST) or remove one from (DELETE ?uploadId=) a playlist. */
export const Route = createFileRoute("/api/playlists/$id/items")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const playlist = await workspacePlaylist(params.id, workspace.id)
          if (!playlist) return json({ error: "Playlist not found" }, 404)
          if (!canEditPlaylist(playlist, user, role)) return json({ error: "Only its creator or an admin can change this playlist" }, 403)
          const parsed = itemSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Choose a video" }, 400)
          const error = await addToPlaylist(playlist, parsed.data.uploadId, user, role)
          return error ? json({ error }, 400) : json({ ok: true })
        }),
      DELETE: ({ request, params }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const playlist = await workspacePlaylist(params.id, workspace.id)
          if (!playlist) return json({ error: "Playlist not found" }, 404)
          if (!canEditPlaylist(playlist, user, role)) return json({ error: "Only its creator or an admin can change this playlist" }, 403)
          const uploadId = new URL(request.url).searchParams.get("uploadId")
          if (!uploadId) return json({ error: "Choose a video" }, 400)
          await removeFromPlaylist(playlist.id, uploadId)
          return json({ ok: true })
        }),
    },
  },
})
