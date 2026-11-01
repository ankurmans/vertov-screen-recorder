import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workspaces } from "@/db/schema"
import { json } from "@/lib/api.server"
import { audit } from "@/lib/audit.server"
import { newScimToken, sha256Hex } from "@/lib/security.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/** Create (or rotate) and revoke the workspace's SCIM token. The token is shown once; only its hash is kept. */
export const Route = createFileRoute("/api/workspace/scim")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            const token = newScimToken()
            await db.update(workspaces).set({ scimTokenHash: await sha256Hex(token) }).where(eq(workspaces.id, workspace.id))
            await audit(workspace.id, user.sub, "scim.token_created")
            return json({ token, baseUrl: `${new URL(request.url).origin}/scim/v2` }, 201)
          },
          { manage: true },
        ),
      DELETE: ({ request }) =>
        workspaceApi(
          request,
          async (user, { workspace }) => {
            await db.update(workspaces).set({ scimTokenHash: null }).where(eq(workspaces.id, workspace.id))
            await audit(workspace.id, user.sub, "scim.token_revoked")
            return json({ ok: true })
          },
          { manage: true },
        ),
    },
  },
})
