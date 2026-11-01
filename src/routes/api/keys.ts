import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { apiKeys } from "@/db/schema"
import { listApiKeys } from "@/lib/api-keys.server"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { newId } from "@/lib/workspace.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const createSchema = z.object({ name: z.string().trim().min(1).max(60) })
const revokeSchema = z.object({ id: z.string().min(1).max(80) })

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

/**
 * Your API keys for the active workspace. A key acts as you, in that workspace only, for agents,
 * scripts and MCP clients. The key is shown once at creation; only its hash is kept.
 * Keys can't manage keys: these routes need a signed-in browser session.
 */
export const Route = createFileRoute("/api/keys")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(request, async (user, { workspace }) => {
          if (user.workspaceId) return json({ error: "Use the website to manage keys" }, 403)
          return json({ keys: await listApiKeys(user.sub, workspace.id) })
        }),
      POST: ({ request }) =>
        workspaceApi(request, async (user, { workspace }) => {
          if (user.workspaceId) return json({ error: "Use the website to manage keys" }, 403)
          const parsed = createSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Name the key, e.g. the agent that will use it" }, 400)
          const token = `rk_${hex(crypto.getRandomValues(new Uint8Array(20)))}`
          const tokenHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))
          const id = newId("k")
          await db.insert(apiKeys).values({ id, userId: user.sub, workspaceId: workspace.id, name: parsed.data.name, tokenHash, prefix: token.slice(0, 7) })
          await audit(workspace.id, user.sub, "api_key.created", parsed.data.name)
          return json({ id, name: parsed.data.name, token }, 201)
        }),
      DELETE: ({ request }) =>
        workspaceApi(request, async (user, { workspace }) => {
          if (user.workspaceId) return json({ error: "Use the website to manage keys" }, 403)
          const parsed = revokeSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Invalid key" }, 400)
          await db
            .update(apiKeys)
            .set({ revokedAt: new Date().toISOString() })
            .where(and(eq(apiKeys.id, parsed.data.id), eq(apiKeys.userId, user.sub)))
          await audit(workspace.id, user.sub, "api_key.revoked", parsed.data.id)
          return json({ ok: true })
        }),
    },
  },
})
