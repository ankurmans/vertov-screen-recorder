import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { folders, spaces, uploads } from "@/db/schema"
import { json } from "@/lib/api.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const renameSchema = z.object({ name: z.string().trim().min(1).max(60) })

/** Rename a space, or delete it: its videos go back to the libraries of the people who recorded them. */
export const Route = createFileRoute("/api/spaces/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const parsed = renameSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Give the space a name" }, 400)
            await db.update(spaces).set({ name: parsed.data.name }).where(and(eq(spaces.id, params.id), eq(spaces.workspaceId, workspace.id)))
            return json({ ok: true })
          },
          { manage: true },
        ),
      DELETE: ({ request, params }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const space = await db.query.spaces.findFirst({ where: and(eq(spaces.id, params.id), eq(spaces.workspaceId, workspace.id)) })
            if (!space) return json({ error: "Space not found" }, 404)
            await db.batch([
              db.update(uploads).set({ spaceId: null, folderId: null }).where(eq(uploads.spaceId, space.id)),
              db.delete(folders).where(eq(folders.spaceId, space.id)),
              db.delete(spaces).where(eq(spaces.id, space.id)),
            ])
            return json({ ok: true })
          },
          { manage: true },
        ),
    },
  },
})
