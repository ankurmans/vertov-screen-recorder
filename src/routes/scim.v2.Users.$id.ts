import { createFileRoute } from "@tanstack/react-router"
import { scimApi, scimDeprovision, scimError, scimGet, scimJson, scimProvision, scimRename } from "@/lib/scim.server"

interface PatchOp {
  op?: string
  path?: string
  value?: unknown
}

const truthy = (value: unknown) => value === true || String(value).toLowerCase() === "true"

/** Reads `active` and a display name out of either a PUT body or a PATCH operations list. */
function intent(body: Record<string, unknown>): { active?: boolean; name?: string } {
  const result: { active?: boolean; name?: string } = {}
  const operations = Array.isArray(body.Operations) ? (body.Operations as Array<PatchOp>) : []
  for (const operation of operations) {
    const path = (operation.path ?? "").toLowerCase()
    const value = operation.value
    if (path === "active") result.active = truthy(value)
    else if (path === "displayname" || path === "name.formatted") result.name = String(value)
    else if (!path && value && typeof value === "object") {
      const record = value as Record<string, unknown>
      if ("active" in record) result.active = truthy(record.active)
      if (typeof record.displayName === "string") result.name = record.displayName
    }
  }
  if ("active" in body) result.active = truthy(body.active)
  if (typeof body.displayName === "string") result.name = body.displayName
  return result
}

/** SCIM 2.0 single user: fetch, replace/patch (active=false deprovisions), delete. */
export const Route = createFileRoute("/scim/v2/Users/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        scimApi(request, async (workspace) => {
          const user = await scimGet(workspace.id, params.id, new URL(request.url).origin)
          return user && user.active ? scimJson(user) : scimError(404, "User not found")
        }),
      PUT: ({ request, params }) => update(request, params.id),
      PATCH: ({ request, params }) => update(request, params.id),
      DELETE: ({ request, params }) =>
        scimApi(request, async (workspace) => {
          const problem = await scimDeprovision(workspace.id, params.id)
          if (problem) return scimError(400, problem)
          return new Response(null, { status: 204 })
        }),
    },
  },
})

function update(request: Request, id: string) {
  return scimApi(request, async (workspace) => {
    const origin = new URL(request.url).origin
    const current = await scimGet(workspace.id, id, origin)
    if (!current) return scimError(404, "User not found")
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const { active, name } = intent(body)
    if (name) await scimRename(id, name)
    if (active === false && current.active) {
      const problem = await scimDeprovision(workspace.id, id)
      if (problem) return scimError(400, problem)
    } else if (active === true && !current.active) {
      await scimProvision(workspace.id, current.userName, name ?? current.displayName)
    }
    return scimJson(await scimGet(workspace.id, id, origin))
  })
}
