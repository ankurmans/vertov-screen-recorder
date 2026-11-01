import { eq } from "drizzle-orm"
import type { Workspace } from "@/db/schema"
import { db } from "@/db"
import { workspaces } from "@/db/schema"
import { listAudit } from "@/lib/audit.server"
import { ssoName } from "@/lib/auth.server"

/** "acme.com, Example.org" becomes ["acme.com", "example.org"]; anything that isn't a bare domain is dropped. */
export function parseDomains(raw: string | null | undefined): Array<string> {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter((domain) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain))
}

/** Null when this email may be in the workspace; otherwise why not. No list means anyone with an invite. */
export function domainProblem(workspace: Pick<Workspace, "allowedDomains">, email: string | null): string | null {
  const domains = parseDomains(workspace.allowedDomains)
  if (domains.length === 0) return null
  if (!email) return `Sign in with a work email first (${domains.map((domain) => `@${domain}`).join(", ")}).`
  const domain = email.toLowerCase().split("@").pop() ?? ""
  return domains.includes(domain) ? null : `This workspace only accepts ${domains.map((value) => `@${value}`).join(", ")} email addresses.`
}

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
export const sha256Hex = async (value: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
export const newScimToken = () => `scim_${hex(crypto.getRandomValues(new Uint8Array(24)))}`

/** What the Security tab shows: policies, SCIM and SSO state, and the activity log. */
export async function securityOverview(workspaceId: string) {
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
  if (!workspace) throw new Error(`workspace ${workspaceId} missing`)
  return {
    retentionDays: workspace.retentionDays,
    allowedDomains: parseDomains(workspace.allowedDomains).join(", "),
    downloadsDefault: workspace.downloadsDefault,
    scimEnabled: Boolean(workspace.scimTokenHash),
    sso: ssoName(),
    audit: await listAudit(workspaceId, 100),
  }
}
