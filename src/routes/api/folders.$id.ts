import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { Folder } from "@/db/schema"
import type { SessionUser } from "@/lib/auth.server"
import type { WorkspaceContext } from "@/lib/workspace.server"
import { db } from "@/db"
import { folders, uploads } from "@/db/schema"
import { json } from "@/lib/api.server"
import { canManage } from "@/lib/plans"
import { workspaceApi } from "@/lib/workspace-api.server"

const renameSchema = z.object({ name: z.string().trim().min(1).max(60) })

/** Your own folders are yours; folders in a space belong to every member of it. */
async function editableFolder(id: string, user: SessionUser, context: WorkspaceContext): Promise<Folder | null> {
  const folder = await db.query.folders.findFirst({ where: eq(folders.id, id) })
  if (!folder || folder.workspaceId !== context.workspace.id) return null
  if (folder.spaceId) return folder
  return folder.ownerId === user.sub || canManage(context.role) ? folder : null
}

/** Rename a folder, or delete it; its videos stay where they are, just outside any folder. */
export const Route = createFileRoute("/api/folders/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        workspaceApi(request, async (user, context) => {
          const folder = await editableFolder(params.id, user, context)
          if (!folder) return json({ error: "Folder not found" }, 404)
          const parsed = renameSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Give the folder a name" }, 400)
          await db.update(folders).set({ name: parsed.data.name }).where(eq(folders.id, folder.id))
          return json({ ok: true })
        }),
      DELETE: ({ request, params }) =>
        workspaceApi(request, async (user, context) => {
          const folder = await editableFolder(params.id, user, context)
          if (!folder) return json({ error: "Folder not found" }, 404)
          await db.batch([
            db.update(uploads).set({ folderId: null }).where(eq(uploads.folderId, folder.id)),
            db.delete(folders).where(eq(folders.id, folder.id)),
          ])
          return json({ ok: true })
        }),
    },
  },
})
