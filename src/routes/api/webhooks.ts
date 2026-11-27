import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { webhookEndpoints } from "@/db/schema"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { isWebhookEvent, listWebhookEndpoints, maxEndpoints, newWebhookSecret, safeWebhookUrl, WEBHOOK_EVENTS } from "@/lib/webhooks"
import { newId } from "@/lib/workspace.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const createSchema = z.object({
  url: z.string().trim().min(1).max(500),
  events: z.array(z.string()).max(10).optional(),
})
const deleteSchema = z.object({ id: z.string().min(1).max(80) })

/**
 * Outgoing webhooks for the active workspace. Owners and admins manage them in a browser session;
 * the signing secret is returned once, at creation.
 */
export const Route = createFileRoute("/api/webhooks")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            if (user.workspaceId) return json({ error: "Use the website to manage webhooks" }, 403)
            return json({ endpoints: await listWebhookEndpoints(workspace.id), events: WEBHOOK_EVENTS })
          },
          { manage: true },
        ),
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            if (user.workspaceId) return json({ error: "Use the website to manage webhooks" }, 403)
            const parsed = createSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Give the https address that should receive events" }, 400)
            const url = safeWebhookUrl(parsed.data.url)
            if (!url) return json({ error: "Use a public https address (no localhost, private networks or custom ports)" }, 400)
            const events = (parsed.data.events?.length ? parsed.data.events : [...WEBHOOK_EVENTS]).filter(isWebhookEvent)
            if (events.length === 0) return json({ error: `Choose from: ${WEBHOOK_EVENTS.join(", ")}` }, 400)
            if ((await listWebhookEndpoints(workspace.id)).length >= maxEndpoints()) return json({ error: "Webhook limit reached" }, 429)
            const id = newId("wh")
            const secret = newWebhookSecret()
            await db.insert(webhookEndpoints).values({ id, workspaceId: workspace.id, createdBy: user.sub, url, secret, events: [...new Set(events)].join(",") })
            await audit(workspace.id, user.sub, "webhook.created", url)
            return json({ id, url, events, secret }, 201)
          },
          { manage: true },
        ),
      DELETE: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            if (user.workspaceId) return json({ error: "Use the website to manage webhooks" }, 403)
            const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Invalid webhook" }, 400)
            await db
              .update(webhookEndpoints)
              .set({ disabledAt: new Date().toISOString() })
              .where(and(eq(webhookEndpoints.id, parsed.data.id), eq(webhookEndpoints.workspaceId, workspace.id)))
            await audit(workspace.id, user.sub, "webhook.deleted", parsed.data.id)
            return json({ ok: true })
          },
          { manage: true },
        ),
    },
  },
})
