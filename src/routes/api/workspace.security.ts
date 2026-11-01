import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { uploads, workspaces } from "@/db/schema"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { parseDomains, securityOverview } from "@/lib/security.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const updateSchema = z.object({
  retentionDays: z.number().int().min(7).max(3650).nullable().optional(),
  allowedDomains: z.string().max(500).nullable().optional(),
  downloadsDefault: z.boolean().optional(),
  applyDownloadsToAll: z.boolean().optional(),
})

/** Retention, join-domain and download policies, plus the activity log. Owners and admins only. */
export const Route = createFileRoute("/api/workspace/security")({
  server: {
    handlers: {
      GET: ({ request }) => workspaceApi(request, async (_user, { workspace }) => json(await securityOverview(workspace.id)), { manage: true }),
      PATCH: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const parsed = updateSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Invalid settings" }, 400)
            const input = parsed.data
            const changes: Partial<typeof workspaces.$inferInsert> = {}
            const notes: Array<string> = []
            if (input.retentionDays !== undefined) {
              changes.retentionDays = input.retentionDays
              notes.push(input.retentionDays ? `retention ${input.retentionDays} days` : "retention back to plan default")
            }
            if (input.allowedDomains !== undefined) {
              const domains = parseDomains(input.allowedDomains)
              if (input.allowedDomains?.trim() && domains.length === 0) return json({ error: "Enter domains like acme.com, separated by commas" }, 400)
              changes.allowedDomains = domains.length ? domains.join(",") : null
              notes.push(domains.length ? `join limited to ${domains.join(", ")}` : "join limit removed")
            }
            if (input.downloadsDefault !== undefined) {
              changes.downloadsDefault = input.downloadsDefault
              notes.push(input.downloadsDefault ? "downloads on by default" : "downloads off by default")
            }
            if (Object.keys(changes).length) await db.update(workspaces).set(changes).where(eq(workspaces.id, workspace.id))
            if (input.applyDownloadsToAll && input.downloadsDefault !== undefined) {
              await db.update(uploads).set({ downloadsEnabled: input.downloadsDefault }).where(eq(uploads.workspaceId, workspace.id))
              notes.push("applied to every video")
            }
            if (notes.length) await audit(workspace.id, user.sub, "security.updated", null, notes.join("; "))
            return json({ ok: true })
          },
          { manage: true },
        ),
    },
  },
})
