import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { canEditPlaylist, deletePlaylist, playlistVideos, updatePlaylist, workspacePlaylist } from "@/lib/playlists.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  visibility: z.enum(["link", "workspace"]).optional(),
  // Upload ids in the new order; ids not in the playlist are ignored.
  order: z.array(z.string().max(64)).max(500).optional(),
})

/** One playlist in the active workspace: read, edit (its creator or an admin) or delete. */
export const Route = createFileRoute("/api/playlists/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const playlist = await workspacePlaylist(params.id, workspace.id)
          if (!playlist) return json({ error: "Playlist not found" }, 404)
          return json({
            playlist: { id: playlist.id, title: playlist.title, description: playlist.description, visibility: playlist.visibility, ownerId: playlist.ownerId },
            canEdit: canEditPlaylist(playlist, user, role),
            videos: await playlistVideos(playlist.id, request),
          })
        }),
      PATCH: ({ request, params }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const playlist = await workspacePlaylist(params.id, workspace.id)
          if (!playlist) return json({ error: "Playlist not found" }, 404)
          if (!canEditPlaylist(playlist, user, role)) return json({ error: "Only its creator or an admin can change this playlist" }, 403)
          const parsed = updateSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Invalid changes" }, 400)
          await updatePlaylist(playlist.id, parsed.data)
          return json({ ok: true })
        }),
      DELETE: ({ request, params }) =>
        workspaceApi(request, async (user, { workspace, role }) => {
          const playlist = await workspacePlaylist(params.id, workspace.id)
          if (!playlist) return json({ error: "Playlist not found" }, 404)
          if (!canEditPlaylist(playlist, user, role)) return json({ error: "Only its creator or an admin can delete this playlist" }, 403)
          await deletePlaylist(playlist.id)
          return json({ ok: true })
        }),
    },
  },
})
