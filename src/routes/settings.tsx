import { BrandMark, Wordmark } from "@/components/brand-mark"
import { NotificationSettings } from "@/components/notification-settings"
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { ArrowLeftIcon, CheckIcon, CopyIcon, LinkSimpleIcon, PuzzlePieceIcon } from "@phosphor-icons/react"
import { useState } from "react"
import type { Role } from "@/lib/plans"
import { canManage } from "@/lib/plans"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME, CHROME_STORE_URL } from "@/lib/brand"
import { listApiKeys } from "@/lib/api-keys.server"
import { listWebhookEndpoints } from "@/lib/webhooks"
import { listInvites, listMembers } from "@/lib/workspace-api.server"
import { getWorkspaceContext, toPublicWorkspace } from "@/lib/workspace.server"
import { askConfirm, showNotice } from "@/components/app-dialog"
import { WatchHow } from "@/components/tutorial-row"
import { AppearanceSettings } from "@/components/appearance-settings"
import { LanguageSelect } from "@/components/language-settings"
import { tNow, translatorFromMatches, useLanguage, useLanguageTag, useT } from "@/lib/i18n/react"
import type { MessageKey } from "@/lib/i18n/en/index"

type Tab = "general" | "members" | "agents"

const loadSettings = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  const user = await getSessionUser(request)
  if (!user) return null
  const { workspace, role } = await getWorkspaceContext(request, user)
  return {
    me: user.sub,
    origin: new URL(request.url).origin,
    workspace: toPublicWorkspace(workspace),
    role,
    members: await listMembers(workspace.id),
    invites: canManage(role) ? await listInvites(workspace.id) : [],
    apiKeys: await listApiKeys(user.sub, workspace.id),
    webhooks: canManage(role) ? await listWebhookEndpoints(workspace.id) : [],
  }
})

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: search.tab === "members" || search.tab === "agents" ? search.tab : undefined,
  }),
  loader: async () => {
    const data = await loadSettings()
    if (!data) throw redirect({ to: "/signin", search: { redirect: "/settings" } })
    return data
  },
  head: ({ matches }) => ({ meta: [{ title: translatorFromMatches(matches)("settings.pageTitle", { app: APP_NAME }) }, { name: "robots", content: "noindex" }] }),
  component: SettingsPage,
})

/** Dates in the app language. English keeps the browser's own date format, as it always did. */
function useDateText() {
  const language = useLanguage()
  const tag = useLanguageTag()
  return (value: string | number) => new Date(value).toLocaleDateString(language === "en" ? undefined : tag)
}

function SettingsPage() {
  const data = Route.useLoaderData()
  const t = useT()
  const { tab = "general" } = Route.useSearch()
  const navigate = useNavigate({ from: "/settings" })
  const tabs: Array<[Tab, string]> = [
    ["general", t("settings.tabs.workspace")],
    ["members", t("settings.tabs.members")],
    ["agents", t("settings.tabs.agents")],
  ]
  return (
    <main className="min-h-dvh bg-neutral-50">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/85 px-4 backdrop-blur">
        <a href="/home" className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-100">
          <BrandMark /> <Wordmark /> <ArrowLeftIcon size={16} /> {t("settings.header.library")}
        </a>
        <span className="truncate text-sm font-semibold text-neutral-900">{data.workspace.name}</span>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{t("settings.title")}</h1>
        <div role="tablist" className="mt-5 flex gap-1 overflow-x-auto border-b border-neutral-200">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => void navigate({ search: { tab: value === "general" ? undefined : value } })}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                tab === value ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-6">
          {tab === "members" ? <MembersTab /> : tab === "agents" ? <AgentsTab /> : <GeneralTab />}
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
  if (!response?.ok) void showNotice(tNow()("settings.notice.didntWork"), typeof data.error === "string" ? data.error : tNow()("common.somethingWrong"))
  return { ok: Boolean(response?.ok), data }
}

function Card({ title, description, tutorial, children }: { title: string; description?: string; tutorial?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-neutral-900">{title}</h2>
        {tutorial && <WatchHow slug={tutorial} />}
      </div>
      {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function GeneralTab() {
  const data = Route.useLoaderData()
  const t = useT()
  const router = useRouter()
  const manage = canManage(data.role)
  const [name, setName] = useState(data.workspace.name)
  const me = data.members.find((member) => member.userId === data.me)

  async function leave() {
    if (!(await askConfirm({ title: t("settings.general.leave.title", { name: data.workspace.name }), body: t("settings.general.leave.body"), confirmLabel: t("settings.general.leave.confirm"), danger: true }))) return
    const { ok } = await send(`/api/workspace/members/${data.me}`, "DELETE")
    if (ok) window.location.href = "/home"
  }

  return (
    <div className="space-y-5">
      <ProfilePictureCard avatar={me?.avatar} name={me?.name ?? ""} />
      <Card title={t("settings.appearance.title")} description={t("settings.appearance.description")}>
        <AppearanceSettings />
      </Card>
      <Card title={t("language.label")} description={t("language.description")}>
        <LanguageSelect signedIn />
      </Card>
      <NotificationSettings />
      <Card title={t("settings.general.workspaceName")}>
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
            aria-label={t("settings.general.workspaceName")}
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
          />
          {manage && (
            <button type="submit" disabled={!name.trim() || name === data.workspace.name} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {t("common.save")}
            </button>
          )}
        </form>
      </Card>
      <Card title={t("settings.general.visibility.title")} description={t("settings.general.visibility.description")}>
        <div className="space-y-2">
          {(
            [
              ["link", t("settings.general.visibility.link.label"), t("settings.general.visibility.link.hint")],
              ["workspace", t("settings.general.visibility.workspace.label"), t("settings.general.visibility.workspace.hint")],
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
      {me && !(me.role === "owner" && data.members.filter((member) => member.role === "owner").length === 1) && (
        <button type="button" onClick={() => void leave()} className="text-sm text-red-600 hover:underline">
          {t("settings.general.leave.button")}
        </button>
      )}
    </div>
  )
}

function MembersTab() {
  const data = Route.useLoaderData()
  const t = useT()
  const dateText = useDateText()
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
        <Card title={t("settings.members.invite.title")} tutorial="invite" description={t("settings.members.invite.description")}>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as "member" | "admin")}
              aria-label={t("settings.members.invite.roleLabel")}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="member">{t("settings.members.invite.joinMember")}</option>
              <option value="admin">{t("settings.members.invite.joinAdmin")}</option>
            </select>
            <button type="button" onClick={() => void createInvite()} className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
              <LinkSimpleIcon size={16} /> {t("settings.members.invite.create")}
            </button>
          </div>
          {data.invites.length > 0 && (
            <ul className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {data.invites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-neutral-700">
                    {t(invite.role === "admin" ? "settings.members.invite.adminLink" : "settings.members.invite.memberLink", { date: dateText(invite.expiresAt) })}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => copy(invite.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100">
                      {copied === invite.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied === invite.id ? t("common.copied") : t("common.copy")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void send("/api/workspace/invites", "DELETE", { id: invite.id }).then(() => router.invalidate())}
                      className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      {t("settings.revoke")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card title={t("settings.members.list.title", { count: data.members.length })} description={t("settings.members.list.description")}>
        <ul className="divide-y divide-neutral-100">
          {data.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 py-2.5">
              <img src={member.avatar} alt="" className="size-8 shrink-0 rounded-full ring-1 ring-neutral-200" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-900">
                  {member.name}
                  {member.userId === data.me && <span className="font-normal text-neutral-500"> {t("settings.members.list.you")}</span>}
                </span>
                {member.email && <span className="block truncate text-xs text-neutral-500">{member.email}</span>}
              </span>
              {manage && member.userId !== data.me ? (
                <>
                  <select
                    value={member.role}
                    aria-label={t("settings.members.list.roleFor", { name: member.name })}
                    onChange={(event) => void send(`/api/workspace/members/${member.userId}`, "PATCH", { role: event.target.value as Role }).then(() => router.invalidate())}
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                  >
                    <option value="member">{t("settings.role.member")}</option>
                    <option value="admin">{t("settings.role.admin")}</option>
                    {data.role === "owner" || member.role === "owner" ? <option value="owner">{t("settings.role.owner")}</option> : null}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await askConfirm({ title: t("settings.members.list.removeTitle", { name: member.name }), body: t("settings.members.list.removeBody"), confirmLabel: t("settings.remove"), danger: true }))) return
                      void send(`/api/workspace/members/${member.userId}`, "DELETE").then(() => router.invalidate())
                    }}
                    className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    {t("settings.remove")}
                  </button>
                </>
              ) : (
                <span className="text-sm text-neutral-500 capitalize">{t(member.role === "owner" ? "settings.role.owner" : member.role === "admin" ? "settings.role.admin" : "settings.role.member")}</span>
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
  const t = useT()
  const dateText = useDateText()
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
    ["claude", t("settings.agents.connect.claudeKey"), `claude mcp add --transport http ${APP_NAME.toLowerCase()} ${server}/mcp --header "Authorization: Bearer ${key}"`],
    [
      "json",
      t("settings.agents.connect.mcpClients"),
      JSON.stringify({ mcpServers: { [APP_NAME.toLowerCase()]: { url: `${server}/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    ],
    [
      "curl",
      t("settings.agents.connect.uploadScript"),
      `curl -X POST '${server}/api/v1/videos?title=What%20I%20changed' \\\n  -H 'Authorization: Bearer ${key}' \\\n  -H 'Content-Type: video/webm' \\\n  --data-binary @recording.webm`,
    ],
    [
      "playwright",
      t("settings.agents.connect.playwright"),
      `const context = await browser.newContext({ recordVideo: { dir: "videos" } })\nconst page = await context.newPage()\n// ...the agent does its work...\nawait context.close() // saves the .webm\nconst file = await page.video().path()\n// then POST it to ${server}/api/v1/videos as above`,
    ],
  ]

  return (
    <div className="space-y-5">
      <Card
        title={t("settings.agents.chrome.title")}
        description={t("settings.agents.chrome.description")}
      >
        <a
          href={CHROME_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          <PuzzlePieceIcon size={16} /> {t("settings.agents.chrome.add")}
        </a>
      </Card>
      <Card
        title={t("settings.agents.keys.title")}
        tutorial="connect-agent"
        description={t("settings.agents.keys.description")}
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
            placeholder={t("settings.agents.keys.namePlaceholder")}
            aria-label={t("settings.agents.keys.nameLabel")}
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
            {t("settings.agents.keys.create")}
          </button>
        </form>
        {created && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">{t("settings.agents.keys.copyNow")}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs">{created}</code>
              <button type="button" onClick={() => copy("key", created)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-amber-100">
                {copied === "key" ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied === "key" ? t("common.copied") : t("common.copy")}
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
                    {apiKey.lastUsedAt ? t("settings.agents.keys.usedOn", { prefix: apiKey.prefix, date: dateText(apiKey.lastUsedAt) }) : t("settings.agents.keys.neverUsed", { prefix: apiKey.prefix })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await askConfirm({ title: t("settings.agents.keys.revokeTitle", { name: apiKey.name }), body: t("settings.agents.keys.revokeBody"), confirmLabel: t("settings.agents.keys.revokeConfirm"), danger: true }))) return
                    void send("/api/keys", "DELETE", { id: apiKey.id }).then(() => router.invalidate())
                  }}
                  className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  {t("settings.revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canManage(data.role) && <WebhooksCard />}
      <Card title={t("settings.agents.connect.title")} description={created ? t("settings.agents.connect.descriptionWithKey") : t("settings.agents.connect.descriptionNoKey")}>
        <div className="space-y-4">
          {snippets.map(([id, label, code]) => (
            <div key={id}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-800">{label}</span>
                <button type="button" onClick={() => copy(id, code)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100">
                  {copied === id ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied === id ? t("common.copied") : t("common.copy")}
                </button>
              </div>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100">{code}</pre>
            </div>
          ))}
          <p className="text-xs text-neutral-500">
            {t("settings.agents.connect.shareCopy")}
          </p>
        </div>
      </Card>
    </div>
  )
}

function ProfilePictureCard({ avatar, name }: { avatar?: string; name: string }) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState<"upload" | "google" | "remove" | null>(null)
  const [error, setError] = useState("")

  async function run(kind: "upload" | "google" | "remove", request: () => Promise<Response>) {
    setBusy(kind)
    setError("")
    const response = await request().catch(() => null)
    setBusy(null)
    if (response?.ok) return void (await router.invalidate())
    const body = (await response?.json().catch(() => null)) as { error?: string } | null
    setError(body?.error ?? t("common.somethingWrong"))
  }

  return (
    <Card title={t("settings.profile.title")} description={t("settings.profile.description")}>
      <div className="flex flex-wrap items-center gap-4">
        {avatar && <img src={avatar} alt={t("settings.profile.alt", { name })} className="size-16 rounded-full object-cover ring-1 ring-neutral-200" />}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("google", () => fetch("/api/profile/avatar?source=google", { method: "POST" }))}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy === "google" ? t("settings.profile.fetching") : t("settings.profile.useGoogle")}
        </button>
        <label className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
          {busy === "upload" ? t("settings.profile.uploading") : t("settings.profile.upload")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void run("upload", () => fetch("/api/profile/avatar", { method: "POST", headers: { "content-type": file.type }, body: file }))
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("remove", () => fetch("/api/profile/avatar", { method: "DELETE" }))}
          className="text-sm text-red-600 hover:underline disabled:opacity-40"
        >
          {t("settings.remove")}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  )
}

const WEBHOOK_EVENT_LABELS: Array<[string, MessageKey]> = [
  ["video.ready", "settings.webhooks.event.videoReady"],
  ["video.viewed", "settings.webhooks.event.videoViewed"],
  ["comment.created", "settings.webhooks.event.commentCreated"],
]

function WebhooksCard() {
  const data = Route.useLoaderData()
  const t = useT()
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [events, setEvents] = useState<Array<string>>(WEBHOOK_EVENT_LABELS.map(([value]) => value))
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setError(null)
    const { ok, data: result } = await send("/api/webhooks", "POST", { url: url.trim(), events })
    if (!ok) return setError(String(result.error ?? t("settings.webhooks.addFailed")))
    setSecret(String(result.secret))
    setUrl("")
    void router.invalidate()
  }

  return (
    <Card
      title={t("settings.webhooks.title")}
      description={t("settings.webhooks.description")}
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
          aria-label={t("settings.webhooks.addressLabel")}
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
              {t(label)}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={events.length === 0} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {t("settings.webhooks.add")}
          </button>
          <a href="/docs/api" className="text-sm text-neutral-600 underline">
            {t("settings.webhooks.apiDocs")}
          </a>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
      {secret && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">{t("settings.webhooks.secretNotice")}</p>
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
                onClick={async () => {
                  if (!(await askConfirm({ title: t("settings.webhooks.deleteTitle"), body: t("settings.webhooks.deleteBody"), confirmLabel: t("settings.webhooks.deleteConfirm"), danger: true }))) return
                  void send("/api/webhooks", "DELETE", { id: hook.id }).then(() => router.invalidate())
                }}
                className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
