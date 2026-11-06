import { refreshWorkspaceCovers } from "@/lib/poster.server"
import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { workspaceMembers, workspaces } from "@/db/schema"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { HEX_COLOR } from "@/lib/brand-theme"
import { listSpaces } from "@/lib/library.server"
import { billingOptions } from "@/lib/polar.server"
import { userApi } from "@/lib/recordings.server"
import { listInvites, listMembers, workspaceApi } from "@/lib/workspace-api.server"
import { canManage } from "@/lib/plans"
import { isHosted, newId, toPublicWorkspace, usageOf, workspaceCookie } from "@/lib/workspace.server"

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  defaultVisibility: z.enum(["link", "workspace"]).optional(),
  brandColor: z.string().regex(HEX_COLOR).transform((value) => value.toLowerCase()).nullable().optional(),
  coverStyle: z.enum(["designed", "frame"]).optional(),
})

const createSchema = z.object({ name: z.string().trim().min(1).max(80) })

/** The active workspace with its members, spaces, usage and billing; rename and settings; create another. */
export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(request, async (user, { workspace, role, memberships }) => {
          const manage = canManage(role)
          const usage = await usageOf(workspace)
          return json({
            workspace: toPublicWorkspace(workspace),
            role,
            memberships,
            members: await listMembers(workspace.id),
            invites: manage ? await listInvites(workspace.id) : [],
            spaces: await listSpaces(workspace.id),
            usage: { usedHours: usage.usedHours, limitHours: Number.isFinite(usage.limitHours) ? usage.limitHours : null },
            hosted: isHosted(),
            billing: billingOptions(),
            me: user.sub,
          })
        }),
      PATCH: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const parsed = updateSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Invalid settings" }, 400)
            if (Object.keys(parsed.data).length === 0) return json({ ok: true })
            await db.update(workspaces).set(parsed.data).where(eq(workspaces.id, workspace.id))
            // A new look or brand colour re-renders the automatic covers; owners' own thumbnails stay.
            if (parsed.data.coverStyle !== undefined || parsed.data.brandColor !== undefined) await refreshWorkspaceCovers(workspace.id)
            await audit(workspace.id, user.sub, "workspace.updated", Object.keys(parsed.data).join(", "))
            return json({ ok: true })
          },
          { manage: true },
        ),
      POST: ({ request }) =>
        userApi(request, async (user) => {
          const parsed = createSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Give the workspace a name" }, 400)
          const id = newId("w")
          await db.batch([
            db.insert(workspaces).values({ id, name: parsed.data.name, createdBy: user.sub }),
            db.insert(workspaceMembers).values({ workspaceId: id, userId: user.sub, role: "owner" }),
          ])
          return json({ id }, { status: 201, headers: { "set-cookie": workspaceCookie(id, request) } })
        }),
    },
  },
})
