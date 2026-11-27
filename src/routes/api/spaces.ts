import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { db } from "@/db"
import { spaces } from "@/db/schema"
import { json } from "@/lib/api.server"
import { newId } from "@/lib/workspace.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const createSchema = z.object({ name: z.string().trim().min(1).max(60) })

/** Shared libraries every workspace member sees. */
export const Route = createFileRoute("/api/spaces")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const parsed = createSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Give the space a name" }, 400)
            const id = newId("s")
            await db.insert(spaces).values({ id, workspaceId: workspace.id, name: parsed.data.name, createdBy: user.sub })
            return json({ id, name: parsed.data.name }, 201)
          },
          { manage: true },
        ),
    },
  },
})
