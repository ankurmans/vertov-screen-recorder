import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workspaces } from "@/db/schema"
import { json } from "@/lib/api.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const MAX_LOGO = 512 * 1024
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

/** Upload (raw image body) or remove the workspace logo. Owners and admins only. */
export const Route = createFileRoute("/api/workspace/brand")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
            const extension = TYPES[type]
            if (!extension) return json({ error: "Logo must be a PNG, JPEG or WebP image" }, 400)
            const bytes = await request.arrayBuffer()
            if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO) return json({ error: "Logo must be under 512 KB" }, 400)
            const key = `brand/${workspace.id}-${crypto.randomUUID().slice(0, 8)}.${extension}`
            await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } })
            const previous = workspace.brandLogoKey
            await db.update(workspaces).set({ brandLogoKey: key }).where(eq(workspaces.id, workspace.id))
            if (previous) await env.BUCKET.delete(previous)
            return json({ ok: true })
          },
          { manage: true },
        ),
      DELETE: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            if (workspace.brandLogoKey) await env.BUCKET.delete(workspace.brandLogoKey)
            await db.update(workspaces).set({ brandLogoKey: null }).where(eq(workspaces.id, workspace.id))
            return json({ ok: true })
          },
          { manage: true },
        ),
    },
  },
})
