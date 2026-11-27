import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { db } from "@/db"
import { folders } from "@/db/schema"
import { json } from "@/lib/api.server"
import { spaceInWorkspace } from "@/lib/library.server"
import { newId } from "@/lib/workspace.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  // Unset: a folder in your own library.
  spaceId: z.string().max(64).nullable().optional(),
})

export const Route = createFileRoute("/api/folders")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(request, async (user, { workspace }) => {
          const parsed = createSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Give the folder a name" }, 400)
          const spaceId = parsed.data.spaceId ?? null
          if (spaceId && !(await spaceInWorkspace(spaceId, workspace.id))) return json({ error: "Unknown space" }, 400)
          const id = newId("f")
          await db.insert(folders).values({
            id,
            workspaceId: workspace.id,
            spaceId,
            ownerId: spaceId ? null : user.sub,
            name: parsed.data.name,
          })
          return json({ id, name: parsed.data.name, spaceId }, 201)
        }),
    },
  },
})
