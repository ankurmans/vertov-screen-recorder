import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { workspaceInvites } from "@/db/schema"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const INVITE_DAYS = 14
const createSchema = z.object({ role: z.enum(["admin", "member"]).default("member") })
const revokeSchema = z.object({ id: z.string().min(1).max(80) })

/** Invite links: anyone with the link joins with its role until it expires or is revoked. No email needed. */
export const Route = createFileRoute("/api/workspace/invites")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const parsed = createSchema.safeParse(await request.json().catch(() => ({})))
            if (!parsed.success) return json({ error: "Invalid role" }, 400)
            const id = [...crypto.getRandomValues(new Uint8Array(18))].map((byte) => byte.toString(16).padStart(2, "0")).join("")
            const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString()
            await db.insert(workspaceInvites).values({ id, workspaceId: workspace.id, role: parsed.data.role, createdBy: user.sub, expiresAt })
            await audit(workspace.id, user.sub, "invite.created", parsed.data.role)
            return json({ id, role: parsed.data.role, expiresAt, url: `${new URL(request.url).origin}/join/${id}` }, 201)
          },
          { manage: true },
        ),
      DELETE: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const parsed = revokeSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Invalid invite" }, 400)
            await db
              .update(workspaceInvites)
              .set({ revokedAt: new Date().toISOString() })
              .where(and(eq(workspaceInvites.id, parsed.data.id), eq(workspaceInvites.workspaceId, workspace.id)))
            await audit(workspace.id, user.sub, "invite.revoked", parsed.data.id.slice(0, 8))
            return json({ ok: true })
          },
          { manage: true },
        ),
    },
  },
})
