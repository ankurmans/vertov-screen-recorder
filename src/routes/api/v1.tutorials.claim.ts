import { createFileRoute } from "@tanstack/react-router"
import { json, optionsResponse } from "@/lib/api.server"
import * as tutorials from "@/lib/tutorials.server"
import { workspaceApi } from "@/lib/workspace-api.server"

import { z } from "zod"

const bodySchema = z.object({ runnerId: z.string().regex(/^[\w-]{4,64}$/) })

/** The runner asks for work. 204 means nothing is waiting; otherwise the job and its recipe, bound to the job's parameters. */
export const Route = createFileRoute("/api/v1/tutorials/claim")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const body = bodySchema.safeParse(await request.json().catch(() => null))
            if (!body.success) return json({ error: "Send {\"runnerId\": \"…\"}" }, 400)
            const claimed = await tutorials.claim(workspace.id, body.data.runnerId, new URL(request.url).origin)
            return claimed ? json(claimed) : new Response(null, { status: 204 })
          },
          { manage: true },
        ),
      OPTIONS: () => optionsResponse(),
    },
  },
})
