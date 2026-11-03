import { useEffect, useState } from "react"
import type { AuditEntry } from "@/lib/audit.server"
import { HOSTED_EDITION } from "@/lib/edition"

interface Overview {
  retentionDays: number | null
  allowedDomains: string
  downloadsDefault: boolean
  scimEnabled: boolean
  sso: string | null
  audit: Array<AuditEntry>
}

interface Candidate {
  userId: string
  name: string
  email: string | null
  role: string
}

async function call(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null)
  const data = ((await response?.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (!response?.ok) alert(typeof data.error === "string" ? data.error : "Something went wrong. Try again.")
  return { ok: Boolean(response?.ok), data }
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-neutral-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

const button = "rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
const primary = "rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"

/** Retention, join domains, downloads, SCIM, ownership transfer and the activity log. Owners and admins only. */
export function SecuritySettings({ isOwner, me }: { isOwner: boolean; me: string }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [members, setMembers] = useState<Array<Candidate>>([])
  const [retention, setRetention] = useState("")
  const [domains, setDomains] = useState("")
  const [downloads, setDownloads] = useState(true)
  const [token, setToken] = useState<{ token: string; baseUrl: string } | null>(null)
  const [heir, setHeir] = useState("")

  async function load() {
    const [security, workspace] = await Promise.all([
      fetch("/api/workspace/security").then((response) => (response.ok ? (response.json() as Promise<Overview>) : null)),
      fetch("/api/workspace").then((response) => (response.ok ? (response.json() as Promise<{ members: Array<Candidate> }>) : null)),
    ])
    if (!security) return
    setOverview(security)
    setRetention(security.retentionDays ? String(security.retentionDays) : "")
    setDomains(security.allowedDomains)
    setDownloads(security.downloadsDefault)
    setMembers((workspace?.members ?? []).filter((member) => member.userId !== me))
  }
  useEffect(() => {
    void load()
  }, [])

  if (!overview) return <p className="text-sm text-neutral-500">Loading…</p>

  const save = async (body: Record<string, unknown>) => {
    const { ok } = await call("/api/workspace/security", "PATCH", body)
    if (ok) await load()
  }

  return (
    <div className="space-y-5">
      <Card title="Video retention" description="Delete videos nobody has watched for this many days, after two email warnings. Leave empty to use your plan's default.">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save({ retentionDays: retention.trim() ? Number(retention) : null })
          }}
        >
          <input
            value={retention}
            onChange={(event) => setRetention(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Plan default"
            aria-label="Retention days"
            className="w-40 rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          />
          <button className={primary}>Save</button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">Between 7 and 3650 days.</p>
      </Card>

      <Card title="Who can join" description="Invite links only work for people with an email at these domains. Leave empty to allow anyone with the link.">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save({ allowedDomains: domains.trim() || null })
          }}
        >
          <input
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            placeholder="acme.com, acme.co.uk"
            aria-label="Allowed email domains"
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          />
          <button className={primary}>Save</button>
        </form>
      </Card>

      <Card title="Downloads" description="Whether viewers can download new videos. You can still change any single video.">
        <label className="flex items-center gap-2 text-sm text-neutral-800">
          <input type="checkbox" checked={downloads} onChange={(event) => setDownloads(event.target.checked)} />
          Allow downloads on new videos
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={primary} onClick={() => void save({ downloadsDefault: downloads })}>
            Save default
          </button>
          <button
            className={button}
            onClick={() => confirm(`Turn downloads ${downloads ? "on" : "off"} for every video in this workspace?`) && void save({ downloadsDefault: downloads, applyDownloadsToAll: true })}
          >
            Apply to every existing video
          </button>
        </div>
      </Card>

      <Card
        title="Single sign-on"
        description={overview.sso ? `People can sign in with ${overview.sso} from the sign-in page.` : "Not set up. Add an OpenID Connect provider with the SSO_OIDC_ISSUER, SSO_OIDC_CLIENT_ID and SSO_OIDC_CLIENT_SECRET settings; see docs/sso.md."}
      >
        <p className="text-sm text-neutral-600">{overview.sso ? "Enabled." : "Disabled."}</p>
      </Card>

      {HOSTED_EDITION && (
      <Card title="SCIM provisioning" description="Let your identity provider add and remove people automatically. Removing someone there removes them from this workspace; their videos stay.">
        {token ? (
          <div className="space-y-2 text-sm">
            <p className="text-neutral-700">Copy these now; the token is not shown again.</p>
            <input readOnly value={token.baseUrl} aria-label="SCIM base URL" className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs" onFocus={(event) => event.target.select()} />
            <input readOnly value={token.token} aria-label="SCIM token" className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs" onFocus={(event) => event.target.select()} />
          </div>
        ) : (
          <p className="text-sm text-neutral-600">{overview.scimEnabled ? "A token is active." : "Off."}</p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            className={primary}
            onClick={async () => {
              const { ok, data } = await call("/api/workspace/scim", "POST")
              if (ok) {
                setToken({ token: String(data.token), baseUrl: String(data.baseUrl) })
                await load()
              }
            }}
          >
            {overview.scimEnabled ? "Rotate token" : "Create token"}
          </button>
          {overview.scimEnabled && (
            <button
              className={button}
              onClick={async () => {
                if (!confirm("Revoke the SCIM token? Your identity provider will stop syncing.")) return
                const { ok } = await call("/api/workspace/scim", "DELETE")
                if (ok) {
                  setToken(null)
                  await load()
                }
              }}
            >
              Revoke
            </button>
          )}
        </div>
      </Card>
      )}

      {isOwner && (
        <Card title="Transfer ownership" description="Make another member the owner. You become an admin.">
          <div className="flex gap-2">
            <select value={heir} onChange={(event) => setHeir(event.target.value)} aria-label="New owner" className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm">
              <option value="">Choose a member</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                  {member.email ? ` (${member.email})` : ""}
                </option>
              ))}
            </select>
            <button
              className={primary}
              disabled={!heir}
              onClick={async () => {
                if (!confirm("Transfer ownership of this workspace? You will become an admin.")) return
                const { ok } = await call("/api/workspace/transfer", "POST", { userId: heir })
                if (ok) window.location.reload()
              }}
            >
              Transfer
            </button>
          </div>
        </Card>
      )}

      <Card title="Activity log" description="Who changed what, newest first.">
        {HOSTED_EDITION && (
          <a href="/api/workspace/audit/csv" className="text-sm font-medium text-neutral-900 underline">
            Download CSV
          </a>
        )}
        {overview.audit.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100 text-sm">
            {overview.audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="w-36 shrink-0 text-xs tabular-nums text-neutral-500">{entry.createdAt.slice(0, 16).replace("T", " ")}</span>
                <span className="font-medium text-neutral-900">{entry.actorName ?? "System"}</span>
                <span className="text-neutral-700">{entry.action}</span>
                {entry.target && <span className="text-neutral-600">{entry.target}</span>}
                {entry.detail && <span className="text-neutral-500">{entry.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
