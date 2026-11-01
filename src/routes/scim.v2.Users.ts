import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { scimApi, scimError, scimGet, scimJson, scimList, scimProvision } from "@/lib/scim.server"

const createSchema = z.object({
  userName: z.string().min(3).max(320),
  displayName: z.string().max(200).optional(),
  name: z.object({ formatted: z.string().optional(), givenName: z.string().optional(), familyName: z.string().optional() }).optional(),
  emails: z.array(z.object({ value: z.string() })).optional(),
})

/** SCIM 2.0 Users: list/filter by userName, and create (provision). Authenticated by the workspace's SCIM token. */
export const Route = createFileRoute("/scim/v2/Users")({
  server: {
    handlers: {
      GET: ({ request }) =>
        scimApi(request, async (workspace) => {
          const url = new URL(request.url)
          const filter = url.searchParams.get("filter")?.match(/^userName\s+eq\s+"([^"]+)"$/i)
          const startIndex = Math.max(1, Number(url.searchParams.get("startIndex")) || 1)
          const count = Math.min(200, Math.max(0, Number(url.searchParams.get("count")) || 100))
          return scimJson(await scimList(workspace.id, url.origin, filter ? filter[1] : null, startIndex, count))
        }),
      POST: ({ request }) =>
        scimApi(request, async (workspace) => {
          const parsed = createSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return scimError(400, "userName (an email address) is required")
          const email = (parsed.data.emails?.[0]?.value ?? parsed.data.userName).trim().toLowerCase()
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return scimError(400, "userName must be an email address")
          const origin = new URL(request.url).origin
          const name = parsed.data.displayName ?? parsed.data.name?.formatted ?? [parsed.data.name?.givenName, parsed.data.name?.familyName].filter(Boolean).join(" ")
          const before = await scimList(workspace.id, origin, email, 1, 1)
          if (before.totalResults > 0) return scimError(409, "That user is already in this workspace")
          const id = await scimProvision(workspace.id, email, name)
          return scimJson(await scimGet(workspace.id, id, origin), 201)
        }),
    },
  },
})
