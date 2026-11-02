import { NotificationSettings } from "@/components/notification-settings"
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router"
import { SecuritySettings } from "@/components/security-settings"
import { SlackSettings } from "@/components/slack-settings"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { ArrowLeftIcon, CheckIcon, CopyIcon, LinkSimpleIcon, PuzzlePieceIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import type { Interval, PlanId, Role } from "@/lib/plans"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { HEX_COLOR } from "@/lib/brand-theme"
import { billingOptions } from "@/lib/polar.server"
import { EXTRA_BLOCK_HOURS, EXTRA_BLOCK_PRICE, PAID_PLANS, PLANS, canManage, formatHours, yearlyPrice } from "@/lib/plans"
import { listApiKeys } from "@/lib/api-keys.server"
import { listWebhookEndpoints } from "@/lib/webhooks"
import { listInvites, listMembers } from "@/lib/workspace-api.server"
import { getWorkspaceContext, isHosted, toPublicWorkspace, usageOf } from "@/lib/workspace.server"

type Tab = "general" | "members" | "agents" | "security" | "billing"

const loadSettings = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  const user = await getSessionUser(request)
  if (!user) return null
  const { workspace, role } = await getWorkspaceContext(request, user)
  const usage = await usageOf(workspace)
  return {
    me: user.sub,
    origin: new URL(request.url).origin,
    workspace: toPublicWorkspace(workspace),
    role,
    members: await listMembers(workspace.id),
    invites: canManage(role) ? await listInvites(workspace.id) : [],
    usage: { usedHours: usage.usedHours, limitHours: Number.isFinite(usage.limitHours) ? usage.limitHours : null },
    hosted: isHosted(),
    billing: billingOptions(),
    apiKeys: await listApiKeys(user.sub, workspace.id),
    webhooks: canManage(role) ? await listWebhookEndpoints(workspace.id) : [],
  }
})

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; paid?: 1 } => ({
    tab: search.tab === "members" || search.tab === "billing" || search.tab === "agents" || search.tab === "security" ? search.tab : undefined,
    paid: search.paid === 1 || search.paid === "1" ? 1 : undefined,
  }),
  loader: async () => {
    const data = await loadSettings()
    if (!data) throw redirect({ to: "/signin", search: { redirect: "/settings" } })
    return data
  },
  head: () => ({ meta: [{ title: `Settings — ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: SettingsPage,
})

function SettingsPage() {
  const data = Route.useLoaderData()
  const { tab = "general", paid } = Route.useSearch()
  const navigate = useNavigate({ from: "/settings" })
  const tabs: Array<[Tab, string]> = [
    ["general", "Workspace"],
    ["members", "Members"],
    ["agents", "Agents"],
    ...(canManage(data.role) ? ([["security", "Security"]] as Array<[Tab, string]>) : []),
    ...(data.hosted ? ([["billing", "Billing"]] as Array<[Tab, string]>) : []),
  ]
  return (
    <main className="min-h-dvh bg-neutral-50">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/85 px-4 backdrop-blur">
        <a href="/" className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-100">
          <ArrowLeftIcon size={16} /> Library
        </a>
        <span className="truncate text-sm font-semibold text-neutral-900">{data.workspace.name}</span>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <NotificationSettings />
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Settings</h1>
        <div role="tablist" className="mt-5 flex gap-1 border-b border-neutral-200">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => void navigate({ search: { tab: value === "general" ? undefined : value } })}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === value ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {paid && tab === "billing" && (
          <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Payment received. Your plan updates within a minute; refresh if it hasn't yet.
          </p>
        )}
        <div className="mt-6">
          {tab === "members" ? <MembersTab /> : tab === "agents" ? <AgentsTab /> : tab === "security" && canManage(data.role) ? <SecuritySettings isOwner={data.role === "owner"} me={data.me} /> : tab === "billing" && data.hosted ? <BillingTab /> : <GeneralTab />}
        </div>
      </div>
    </main>
  )
}

async function send(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
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

function GeneralTab() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const manage = canManage(data.role)
  const [name, setName] = useState(data.workspace.name)
  const me = data.members.find((member) => member.userId === data.me)

  async function leave() {
    if (!confirm(`Leave ${data.workspace.name}? Your videos stay in it.`)) return
    const { ok } = await send(`/api/workspace/members/${data.me}`, "DELETE")
    if (ok) window.location.href = "/"
  }

  return (
    <div className="space-y-5">
      <Card title="Workspace name">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void send("/api/workspace", "PATCH", { name }).then(() => router.invalidate())
          }}
        >
          <input
            value={name}
            disabled={!manage}
            onChange={(event) => setName(event.target.value)}
            aria-label="Workspace name"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
          />
          {manage && (
            <button type="submit" disabled={!name.trim() || name === data.workspace.name} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Save
            </button>
          )}
        </form>
      </Card>
      <Card title="Who can watch new videos" description="Each video can still be changed on its own.">
        <div className="space-y-2">
          {(
            [
              ["link", "Anyone with the link", "Viewers never need an account."],
              ["workspace", "Workspace members only", "Viewers sign in with an account in this workspace."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${manage ? "cursor-pointer" : ""} ${data.workspace.defaultVisibility === value ? "border-neutral-900" : "border-neutral-200"}`}>
              <input
                type="radio"
                name="visibility"
                className="mt-1"
                disabled={!manage}
                checked={data.workspace.defaultVisibility === value}
                onChange={() => void send("/api/workspace", "PATCH", { defaultVisibility: value }).then(() => router.invalidate())}
              />
              <span>
                <span className="block text-sm font-medium text-neutral-900">{label}</span>
                <span className="block text-xs text-neutral-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
      {manage && <SlackSettings />}
      {manage && <BrandingCard />}
      {manage && <WorkspaceInsightsCard />}
      {me && !(me.role === "owner" && data.members.filter((member) => member.role === "owner").length === 1) && (
        <button type="button" onClick={() => void leave()} className="text-sm text-red-600 hover:underline">
          Leave this workspace
        </button>
      )}
    </div>
  )
}

function MembersTab() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const manage = canManage(data.role)
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member")
  const [copied, setCopied] = useState<string | null>(null)

  function copy(id: string) {
    void navigator.clipboard.writeText(`${data.origin}/join/${id}`)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  async function createInvite() {
    const { ok, data: invite } = await send("/api/workspace/invites", "POST", { role: inviteRole })
    if (!ok) return
    copy(String(invite.id))
    void router.invalidate()
  }

  return (
    <div className="space-y-5">
      {manage && (
        <Card title="Invite people" description="Anyone with the link can join for 14 days. Members never cost anything.">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as "member" | "admin")}
              aria-label="Role for people who join"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="member">Join as member</option>
              <option value="admin">Join as admin</option>
            </select>
            <button type="button" onClick={() => void createInvite()} className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
              <LinkSimpleIcon size={16} /> Create and copy link
            </button>
          </div>
          {data.invites.length > 0 && (
            <ul className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {data.invites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-neutral-700">
                    {invite.role === "admin" ? "Admin" : "Member"} link · expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => copy(invite.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100">
                      {copied === invite.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied === invite.id ? "Copied" : "Copy"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void send("/api/workspace/invites", "DELETE", { id: invite.id }).then(() => router.invalidate())}
                      className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card title={`${data.members.length} ${data.members.length === 1 ? "member" : "members"}`} description="Admins manage members, spaces and billing. Owners also hand out ownership.">
        <ul className="divide-y divide-neutral-100">
          {data.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 py-2.5">
              <img src={member.avatar} alt="" className="size-8 shrink-0 rounded-full ring-1 ring-neutral-200" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-900">
                  {member.name}
                  {member.userId === data.me && <span className="font-normal text-neutral-500"> (you)</span>}
                </span>
                {member.email && <span className="block truncate text-xs text-neutral-500">{member.email}</span>}
              </span>
              {manage && member.userId !== data.me ? (
                <>
                  <select
                    value={member.role}
                    aria-label={`Role for ${member.name}`}
                    onChange={(event) => void send(`/api/workspace/members/${member.userId}`, "PATCH", { role: event.target.value as Role }).then(() => router.invalidate())}
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    {data.role === "owner" || member.role === "owner" ? <option value="owner">Owner</option> : null}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(`Remove ${member.name}? Their videos stay in the workspace.`)) return
                      void send(`/api/workspace/members/${member.userId}`, "DELETE").then(() => router.invalidate())
                    }}
                    className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-sm text-neutral-500 capitalize">{member.role}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function AgentsTab() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState("")
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const key = created ?? "rk_your_key"
  const server = data.origin

  function copy(id: string, value: string) {
    void navigator.clipboard.writeText(value)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  async function create() {
    const { ok, data: result } = await send("/api/keys", "POST", { name: name.trim() || "Agent" })
    if (!ok) return
    setCreated(String(result.token))
    setName("")
    void router.invalidate()
  }

  const snippets: Array<[string, string, string]> = [
    ["claude", "Claude Code", `claude mcp add --transport http ${APP_NAME.toLowerCase()} ${server}/mcp --header "Authorization: Bearer ${key}"`],
    [
      "json",
      "Cursor, Claude Desktop and other MCP clients",
      JSON.stringify({ mcpServers: { [APP_NAME.toLowerCase()]: { url: `${server}/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    ],
    [
      "curl",
      "Upload a recording from a script",
      `curl -X POST '${server}/api/v1/videos?title=What%20I%20changed' \\\n  -H 'Authorization: Bearer ${key}' \\\n  -H 'Content-Type: video/webm' \\\n  --data-binary @recording.webm`,
    ],
    [
      "playwright",
      "Record a browser agent with Playwright, then upload",
      `const context = await browser.newContext({ recordVideo: { dir: "videos" } })\nconst page = await context.newPage()\n// ...the agent does its work...\nawait context.close() // saves the .webm\nconst file = await page.video().path()\n// then POST it to ${server}/api/v1/videos as above`,
    ],
  ]

  return (
    <div className="space-y-5">
      <Card
        title="Chrome extension"
        description="Record any tab or your whole screen from the toolbar, with click capture so agents see what you did. Until it is in the Chrome Web Store: download it, unzip it, open chrome://extensions, turn on Developer mode and choose Load unpacked."
      >
        <a
          href="/extension/vertov-extension.zip"
          download
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          <PuzzlePieceIcon size={16} /> Download the extension
        </a>
      </Card>
      <Card
        title="Let agents record and read videos"
        description="An API key lets an agent or script act as you in this workspace: upload a recording and get a share link back, or read any video it can see as a transcript and brief. No computer use needed: browser agents already have video from Playwright or a screencast."
      >
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Key name, e.g. Claude Code"
            aria-label="Key name"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
            Create key
          </button>
        </form>
        {created && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">Copy this key now. It won't be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs">{created}</code>
              <button type="button" onClick={() => copy("key", created)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-amber-100">
                {copied === "key" ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied === "key" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        {data.apiKeys.length > 0 && (
          <ul className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {data.apiKeys.map((apiKey) => (
              <li key={apiKey.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-neutral-900">{apiKey.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {apiKey.prefix}… · {apiKey.lastUsedAt ? `used ${new Date(apiKey.lastUsedAt).toLocaleDateString()}` : "never used"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Revoke “${apiKey.name}”? Anything using it stops working.`)) return
                    void send("/api/keys", "DELETE", { id: apiKey.id }).then(() => router.invalidate())
                  }}
                  className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canManage(data.role) && <WebhooksCard />}
      <Card title="Connect" description={created ? "These include your new key." : "Create a key above and these fill in with it."}>
        <div className="space-y-4">
          {snippets.map(([id, label, code]) => (
            <div key={id}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-800">{label}</span>
                <button type="button" onClick={() => copy(id, code)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100">
                  {copied === id ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied === id ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100">{code}</pre>
            </div>
          ))}
          <p className="text-xs text-neutral-500">
            MCP tools: upload_video, create_video_from_url, list_videos, get_video, get_video_prompt, add_comment, list_spaces. Anyone watching a video can also use Share → Copy for an AI agent.
          </p>
        </div>
      </Card>
    </div>
  )
}

function BillingTab() {
  const data = Route.useLoaderData()
  const manage = canManage(data.role)
  const [interval, setInterval] = useState<Interval>(data.workspace.planInterval === "year" ? "year" : "month")
  const [busy, setBusy] = useState<string | null>(null)
  const [blocks, setBlocks] = useState(data.workspace.extraBlocks)
  const current = PLANS[data.workspace.plan]
  const limit = data.usage.limitHours ?? 0
  const fraction = limit ? Math.min(1, data.usage.usedHours / limit) : 0

  async function choose(plan: PlanId) {
    if (plan === "free") return
    setBusy(plan)
    const { ok, data: result } = await send("/api/billing/checkout", "POST", { plan, interval })
    setBusy(null)
    if (!ok) return
    if (typeof result.url === "string") window.location.href = result.url
    else window.location.reload()
  }

  async function saveBlocks() {
    setBusy("extra")
    const { ok, data: result } = await send("/api/billing/extra", "POST", { blocks })
    setBusy(null)
    if (!ok) return
    if (typeof result.url === "string") window.location.href = result.url
    else window.location.reload()
  }

  async function portal() {
    setBusy("portal")
    const { ok, data: result } = await send("/api/billing/portal", "POST")
    setBusy(null)
    if (ok && typeof result.url === "string") window.location.href = result.url
  }

  return (
    <div className="space-y-5">
      <Card title={`${current.name} plan`} description={current.blurb}>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-neutral-700">Library</span>
          <span className="text-neutral-600 tabular-nums">
            {formatHours(data.usage.usedHours)} of {formatHours(limit)}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
          <div className={`h-full rounded-full ${fraction >= 1 ? "bg-red-600" : "bg-neutral-900"}`} style={{ width: `${Math.max(2, fraction * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Hours count the length of every video you keep, recorded or uploaded. When the library is full, new recordings wait until you add hours or make room. Nothing is ever deleted for going over.
          {data.workspace.planStatus === "canceling" && data.workspace.planPeriodEnd && ` Your plan ends on ${new Date(data.workspace.planPeriodEnd).toLocaleDateString()}.`}
          {data.workspace.planStatus === "past_due" && " Your last payment didn't go through; update your card to keep the plan."}
        </p>
        {manage && data.billing.enabled && data.workspace.plan !== "free" && (
          <button type="button" disabled={busy !== null} onClick={() => void portal()} className="mt-3 text-sm font-medium text-neutral-900 underline disabled:opacity-50">
            Manage card, invoices or cancel
          </button>
        )}
      </Card>

      {!data.billing.enabled ? (
        <Card title="Paid plans" description="Payments aren't switched on for this server yet. Everything here is free until they are." >
          <PlanGrid interval={interval} current={data.workspace.plan} manage={false} busy={null} onChoose={() => {}} />
        </Card>
      ) : (
        <Card title="Plans" description="Per workspace. Members and viewers are always free.">
          {data.billing.yearly && (
            <div className="mb-4 inline-flex rounded-lg bg-neutral-100 p-1 text-sm">
              {(["month", "year"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInterval(value)}
                  className={`rounded-md px-3 py-1 ${interval === value ? "bg-white font-medium shadow-sm" : "text-neutral-600"}`}
                >
                  {value === "month" ? "Monthly" : "Yearly, 2 months free"}
                </button>
              ))}
            </div>
          )}
          <PlanGrid interval={interval} current={data.workspace.plan} manage={manage} busy={busy} onChoose={(plan) => void choose(plan)} />
          {!manage && <p className="mt-3 text-xs text-neutral-500">Only workspace owners and admins can change the plan.</p>}
        </Card>
      )}

      {data.billing.extraHours && manage && data.workspace.plan !== "free" && (
        <Card title="Extra hours" description={`$${EXTRA_BLOCK_PRICE} a month for each ${EXTRA_BLOCK_HOURS} hours on top of your plan. Remove them any time.`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-lg border border-neutral-300">
              <button type="button" aria-label="Fewer" onClick={() => setBlocks((value) => Math.max(0, value - 1))} className="px-3 py-1.5 text-lg leading-none">
                −
              </button>
              <span className="w-24 text-center text-sm tabular-nums">{blocks * EXTRA_BLOCK_HOURS} hours</span>
              <button type="button" aria-label="More" onClick={() => setBlocks((value) => Math.min(200, value + 1))} className="px-3 py-1.5 text-lg leading-none">
                +
              </button>
            </div>
            <span className="text-sm text-neutral-600">${blocks * EXTRA_BLOCK_PRICE}/mo</span>
            <button
              type="button"
              disabled={busy !== null || blocks === data.workspace.extraBlocks}
              onClick={() => void saveBlocks()}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}

function PlanGrid({
  interval,
  current,
  manage,
  busy,
  onChoose,
}: {
  interval: Interval
  current: PlanId
  manage: boolean
  busy: string | null
  onChoose: (plan: PlanId) => void
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {PAID_PLANS.map((id) => {
        const plan = PLANS[id]
        const price = interval === "year" ? yearlyPrice(plan) : plan.monthly
        const isCurrent = current === id
        return (
          <li key={id} className={`flex flex-col rounded-xl border p-4 ${isCurrent ? "border-neutral-900" : "border-neutral-200"}`}>
            <span className="text-sm font-semibold text-neutral-900">{plan.name}</span>
            <span className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
              ${price}
              <span className="text-sm font-normal text-neutral-500">/{interval === "year" ? "yr" : "mo"}</span>
            </span>
            <span className="mt-1 text-sm text-neutral-700">{plan.hours.toLocaleString()} hours of video</span>
            <span className="mt-1 flex-1 text-xs text-neutral-500">{plan.blurb}</span>
            {manage && (
              <button
                type="button"
                disabled={isCurrent || busy !== null}
                onClick={() => onChoose(id)}
                className="mt-3 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:bg-neutral-200 disabled:text-neutral-500"
              >
                {isCurrent ? "Current plan" : busy === id ? "Opening…" : current === "free" ? `Choose ${plan.name}` : `Switch to ${plan.name}`}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function BrandingCard() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [color, setColor] = useState(data.workspace.brandColor ?? "")
  const [busy, setBusy] = useState(false)
  const valid = color === "" || HEX_COLOR.test(color)

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    const response = await fetch("/api/workspace/brand", { method: "POST", headers: { "content-type": file.type }, body: file }).catch(() => null)
    setBusy(false)
    if (response?.ok) await router.invalidate()
    else alert("Use a PNG, JPEG or WebP logo under 512 KB.")
  }

  return (
    <Card title="Branding" description="Your logo and accent color on share pages and embeds. Available on every plan.">
      <div className="flex flex-wrap items-center gap-4">
        {data.workspace.hasLogo ? (
          <img src={`/api/brand/${data.workspace.id}`} alt="Current logo" className="h-10 max-w-40 rounded border border-neutral-200 object-contain p-1" />
        ) : (
          <span className="text-sm text-neutral-500">No logo yet</span>
        )}
        <label className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
          {busy ? "Uploading…" : data.workspace.hasLogo ? "Replace logo" : "Upload logo"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(event) => void upload(event.target.files?.[0])} />
        </label>
        {data.workspace.hasLogo && (
          <button type="button" onClick={() => void send("/api/workspace/brand", "DELETE").then(() => router.invalidate())} className="text-sm text-red-600 hover:underline">
            Remove
          </button>
        )}
      </div>
      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send("/api/workspace", "PATCH", { brandColor: color === "" ? null : color }).then(() => router.invalidate())
        }}
      >
        <input
          type="color"
          aria-label="Accent color picker"
          value={HEX_COLOR.test(color) ? color : "#2563eb"}
          onChange={(event) => setColor(event.target.value)}
          className="size-9 cursor-pointer rounded border border-neutral-300 bg-white p-0.5"
        />
        <input
          value={color}
          onChange={(event) => setColor(event.target.value.trim())}
          placeholder="#2563eb"
          aria-label="Accent color"
          className="w-32 rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm"
        />
        <button type="submit" disabled={!valid || color === (data.workspace.brandColor ?? "")} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Save
        </button>
        {!valid && <span className="text-xs text-red-600">Use a hex color like #2563eb</span>}
      </form>
    </Card>
  )
}

interface WorkspaceInsights {
  totalVideos: number
  totalViews: number
  averageCompletion: number | null
  top: Array<{ id: string; title: string | null; views: number }>
  days: Array<{ day: string; views: number }>
}

function WorkspaceInsightsCard() {
  const [stats, setStats] = useState<WorkspaceInsights | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/workspace/insights")
      .then((response) => (response.ok ? (response.json() as Promise<WorkspaceInsights>) : null))
      .then((body) => !cancelled && setStats(body))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const peak = Math.max(1, ...(stats?.days.map((day) => day.views) ?? []))

  return (
    <Card title="Insights" description="Views across every video in this workspace.">
      {!stats ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Videos", stats.totalVideos.toLocaleString()],
              ["Views", stats.totalViews.toLocaleString()],
              ["Avg. watched", stats.averageCompletion == null ? "—" : `${Math.round(stats.averageCompletion * 100)}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-neutral-50 px-3 py-3">
                <dd className="text-xl font-semibold text-neutral-900">{value}</dd>
                <dt className="text-xs text-neutral-500">{label}</dt>
              </div>
            ))}
          </dl>
          <div>
            <p className="text-xs font-medium text-neutral-500">Views per day, last 30 days</p>
            <div className="mt-2 flex h-20 items-end gap-0.5" role="img" aria-label="Views per day for the last 30 days">
              {stats.days.map((day) => (
                <div key={day.day} title={`${day.day}: ${day.views}`} className="flex-1 rounded-sm bg-neutral-900/80" style={{ height: `${Math.max(day.views > 0 ? 6 : 2, (day.views / peak) * 100)}%`, opacity: day.views > 0 ? 1 : 0.15 }} />
              ))}
            </div>
          </div>
          {stats.top.length > 0 && (
            <div>
              <p className="text-xs font-medium text-neutral-500">Top videos</p>
              <ol className="mt-2 divide-y divide-neutral-100 text-sm">
                {stats.top.map((video) => (
                  <li key={video.id} className="flex items-center justify-between gap-3 py-1.5">
                    <a href={`/${video.id}`} className="truncate text-neutral-800 hover:underline">
                      {video.title?.trim() || "Untitled video"}
                    </a>
                    <span className="shrink-0 text-neutral-500">{video.views.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <a href="/api/workspace/insights?format=csv" className="inline-block rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
            Download CSV
          </a>
        </div>
      )}
    </Card>
  )
}

const WEBHOOK_EVENT_LABELS: Array<[string, string]> = [
  ["video.ready", "A video is ready"],
  ["video.viewed", "Someone views a video"],
  ["comment.created", "Someone comments"],
]

function WebhooksCard() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [events, setEvents] = useState<Array<string>>(WEBHOOK_EVENT_LABELS.map(([value]) => value))
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setError(null)
    const { ok, data: result } = await send("/api/webhooks", "POST", { url: url.trim(), events })
    if (!ok) return setError(String(result.error ?? "Couldn't add that webhook"))
    setSecret(String(result.secret))
    setUrl("")
    void router.invalidate()
  }

  return (
    <Card
      title="Webhooks"
      description="Get a signed POST to your own address when something happens, to drive Zapier, n8n, Make or your own code. Payloads and signature checks are in the API docs."
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/hooks/vertov"
          aria-label="Webhook address"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {WEBHOOK_EVENT_LABELS.map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={events.includes(value)}
                onChange={(event) => setEvents(event.target.checked ? [...events, value] : events.filter((entry) => entry !== value))}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={events.length === 0} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Add webhook
          </button>
          <a href="/docs/api" className="text-sm text-neutral-600 underline">
            API docs
          </a>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
      {secret && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Copy the signing secret now. It won't be shown again.</p>
          <code className="mt-2 block truncate rounded bg-white px-2 py-1 font-mono text-xs">{secret}</code>
        </div>
      )}
      {data.webhooks.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {data.webhooks.map((hook) => (
            <li key={hook.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-neutral-900">{hook.url}</span>
                <span className="block text-xs text-neutral-500">{hook.events.split(",").join(", ")}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!confirm("Delete this webhook? It stops receiving events.")) return
                  void send("/api/webhooks", "DELETE", { id: hook.id }).then(() => router.invalidate())
                }}
                className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
