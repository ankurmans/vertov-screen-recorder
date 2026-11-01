import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import {
  ArchiveIcon,
  CaretDownIcon,
  CheckIcon,
  FilmStripIcon,
  FolderIcon,
  FolderPlusIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SignOutIcon,
  UserIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import type { Folder, Space } from "@/db/schema"
import type { LibraryVideo, LibraryView } from "@/lib/library.server"
import { ImportDialog } from "@/components/import-dialog"
import { RequestDialog } from "@/components/request-dialog"
import { SimpleHome } from "@/components/simple-home"
import { getSessionUser, googleClientId } from "@/lib/auth.server"
import { authClient } from "@/lib/auth-client"
import { APP_NAME } from "@/lib/brand"
import { formatDuration, formatTimeAgo, formatViews } from "@/lib/format"
import { flaggedVideos, listFolders, listLibrary, listSpaces } from "@/lib/library.server"
import { SaveAccountBanner } from "@/components/save-account"
import { canManage, formatHours } from "@/lib/plans"
import { getWorkspaceContext, isHosted, toPublicWorkspace, usageOf } from "@/lib/workspace.server"

interface LibrarySearch {
  import?: 1
  view?: "space" | "archive"
  space?: string
  folder?: string
  q?: string
}

type LibraryDeps = Omit<LibrarySearch, "import">

const loadLibrary = createServerFn({ method: "GET" })
  .validator((deps: LibraryDeps) => deps)
  .handler(async ({ data }) => {
    const request = getRequest()
    const user = await getSessionUser(request)
    const origin = new URL(request.url).origin
    if (!user) return { user: null, origin, googleClientId: googleClientId() } as const
    const { workspace, role, memberships } = await getWorkspaceContext(request, user)
    const spaces = await listSpaces(workspace.id)
    const space = data.view === "space" ? (spaces.find((item) => item.id === data.space) ?? null) : null
    const view: LibraryView = data.q
      ? { kind: "search", query: data.q }
      : data.view === "archive"
        ? { kind: "archive" }
        : space
          ? { kind: "space", spaceId: space.id, folderId: data.folder ?? null }
          : { kind: "mine", folderId: data.folder ?? null }
    const [videos, folders, flagged, usage] = await Promise.all([
      listLibrary(workspace.id, user.sub, view),
      listFolders(workspace.id, user.sub),
      flaggedVideos(workspace.id, user.sub),
      usageOf(workspace),
    ])
    return {
      user,
      origin,
      workspace: toPublicWorkspace(workspace),
      role,
      memberships,
      spaces,
      folders,
      videos,
      view,
      flaggedCount: flagged.length,
      hosted: isHosted(),
      usage: { usedHours: usage.usedHours, limitHours: Number.isFinite(usage.limitHours) ? usage.limitHours : null },
    } as const
  })

const TITLE = `${APP_NAME}: the screen recorder that replaces the meeting`
const DESCRIPTION =
  "Record your screen and camera, share a link, and skip the call. Priced by hours of video stored, with free viewers, edit by transcript, and an MCP server for agents. A Loom alternative."

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    import: search.import === 1 || search.import === "1" ? 1 : undefined,
    view: search.view === "space" || search.view === "archive" ? search.view : undefined,
    space: typeof search.space === "string" ? search.space : undefined,
    folder: typeof search.folder === "string" ? search.folder : undefined,
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
  }),
  loaderDeps: ({ search }) => ({ view: search.view, space: search.space, folder: search.folder, q: search.q }),
  loader: ({ deps }) => loadLibrary({ data: deps }),
  head: ({ loaderData }) => {
    const image = loaderData ? `${loaderData.origin}/logo.png` : "/logo.png"
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESCRIPTION },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESCRIPTION },
        { property: "og:type", content: "website" },
        { property: "og:image", content: image },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:image", content: image },
      ],
    }
  },
  component: HomePage,
})

function HomePage() {
  const data = Route.useLoaderData()
  if (!data.user) return <SimpleHome />
  return <Library data={data} />
}

type LoadedLibrary = Exclude<Awaited<ReturnType<typeof loadLibrary>>, { user: null }>

function Library({ data }: { data: LoadedLibrary }) {
  const { user, workspace, role, memberships, spaces, folders, view, usage, hosted, flaggedCount } = data
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/" })
  const router = useRouter()
  const [videos, setVideos] = useState(data.videos)
  const [adding, setAdding] = useState(Boolean(search.import))
  const [requesting, setRequesting] = useState(false)
  const [query, setQuery] = useState(search.q ?? "")
  const [moving, setMoving] = useState<LibraryVideo | null>(null)
  const [combining, setCombining] = useState(false)
  const [picked, setPicked] = useState<Array<string>>([])
  const [combineBusy, setCombineBusy] = useState(false)
  useEffect(() => setVideos(data.videos), [data.videos])
  useEffect(() => setQuery(search.q ?? ""), [search.q])

  // Imports finish in the background; check back until they land.
  const importing = videos.some((video) => video.status === "importing" || video.status === "rendering")
  useEffect(() => {
    if (!importing) return
    const timer = setInterval(() => void router.invalidate(), 4000)
    return () => clearInterval(timer)
  }, [importing, router])

  // Search as you type, a beat after the last key.
  useEffect(() => {
    const next = query.trim()
    if (next === (search.q ?? "")) return
    const timer = setTimeout(() => void navigate({ search: (prev) => ({ ...prev, q: next || undefined }) }), 300)
    return () => clearTimeout(timer)
  }, [query, search.q, navigate])

  const spaceId = view.kind === "space" ? view.spaceId : null
  const currentSpace = spaces.find((space) => space.id === spaceId) ?? null
  const folderId = view.kind === "mine" || view.kind === "space" ? view.folderId : null
  const placeFolders = folders.filter((folder) => (spaceId ? folder.spaceId === spaceId : !folder.spaceId))
  const currentFolder = folders.find((folder) => folder.id === folderId) ?? null
  const heading =
    view.kind === "search"
      ? `Results for “${view.query}”`
      : view.kind === "archive"
        ? "Archive"
        : currentFolder
          ? currentFolder.name
          : currentSpace
            ? currentSpace.name
            : "My videos"
  const refresh = () => void router.invalidate()

  async function patchVideo(video: LibraryVideo, changes: Record<string, unknown>, remove = true) {
    const response = await fetch(`/api/recordings/${video.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    })
    if (!response.ok) return
    if (remove) setVideos((items) => items.filter((item) => item.id !== video.id))
    else refresh()
  }

  async function newFolder() {
    const name = prompt("Folder name")?.trim()
    if (!name) return
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, spaceId }),
    })
    if (response.ok) refresh()
  }

  async function renameFolder(folder: Folder) {
    const name = prompt("Rename folder", folder.name)?.trim()
    if (!name || name === folder.name) return
    await fetch(`/api/folders/${folder.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
    refresh()
  }

  async function deleteFolder(folder: Folder) {
    if (!confirm(`Delete the folder “${folder.name}”? The videos in it stay where they are.`)) return
    await fetch(`/api/folders/${folder.id}`, { method: "DELETE" })
    void navigate({ search: (prev) => ({ ...prev, folder: undefined }) })
  }

  function togglePick(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.length >= 10 ? current : [...current, id]))
  }

  async function combine() {
    setCombineBusy(true)
    const response = await fetch("/api/combine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: picked }),
    }).catch(() => null)
    setCombineBusy(false)
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: string } | null
      alert(body?.error ?? "Couldn't start combining. Try again.")
      return
    }
    setCombining(false)
    setPicked([])
    refresh()
  }

  async function newSpace() {
    const name = prompt("Name the space (everyone in the workspace will see it)")?.trim()
    if (!name) return
    const response = await fetch("/api/spaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
    if (!response.ok) return
    const created: { id: string } = await response.json()
    void navigate({ search: { view: "space", space: created.id } })
  }

  return (
    <main className="min-h-dvh bg-neutral-50">
      <SaveAccountBanner />
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/85 px-4 backdrop-blur">
        <WorkspaceSwitcher current={workspace.id} name={workspace.name} memberships={memberships} />
        <label className="relative ml-auto hidden max-w-sm flex-1 sm:block">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and what was said"
            aria-label="Search videos"
            className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pr-3 pl-9 text-sm focus:border-neutral-400 focus:outline-none"
          />
        </label>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="hidden rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 sm:block"
          >
            Upload or import
          </button>
          <button
            type="button"
            onClick={() => setRequesting(true)}
            className="hidden rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 sm:block"
          >
            Request a video
          </button>
          <a
            href={spaceId ? `/record?space=${spaceId}` : "/record"}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white shadow-sm transition-colors hover:bg-red-500"
          >
            <span className="size-2 rounded-full bg-white" /> New video
          </a>
          <AccountMenu name={user.name} avatar={user.avatar} />
        </div>
      </header>

      {requesting && <RequestDialog onClose={() => setRequesting(false)} />}
      {adding && <ImportDialog onClose={() => setAdding(false)} onImported={refresh} />}
      {moving && (
        <MoveDialog
          video={moving}
          spaces={spaces}
          folders={folders}
          onClose={() => setMoving(null)}
          onMove={(changes) => {
            void patchVideo(moving, changes, true)
            setMoving(null)
          }}
        />
      )}

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6">
        <nav aria-label="Library" className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-20 space-y-6">
            <div className="space-y-0.5">
              <NavLink active={view.kind === "mine" && !folderId} icon={<UserIcon size={16} />} onClick={() => void navigate({ search: {} })}>
                My videos
              </NavLink>
              <NavLink active={view.kind === "archive"} icon={<ArchiveIcon size={16} />} onClick={() => void navigate({ search: { view: "archive" } })}>
                Archive
              </NavLink>
            </div>
            <div>
              <div className="flex items-center justify-between px-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                Spaces
                {canManage(role) && (
                  <button type="button" aria-label="New space" onClick={() => void newSpace()} className="rounded p-0.5 hover:bg-neutral-200">
                    <PlusIcon size={14} />
                  </button>
                )}
              </div>
              <div className="mt-1 space-y-0.5">
                {spaces.map((space) => (
                  <NavLink
                    key={space.id}
                    active={spaceId === space.id && !folderId}
                    icon={<UsersThreeIcon size={16} />}
                    onClick={() => void navigate({ search: { view: "space", space: space.id } })}
                  >
                    {space.name}
                  </NavLink>
                ))}
                {spaces.length === 0 && (
                  <p className="px-2.5 py-1 text-xs text-neutral-500">
                    {canManage(role) ? "Make a space to share videos with everyone here." : "No spaces yet."}
                  </p>
                )}
              </div>
            </div>
            <UsageMeter usedHours={usage.usedHours} limitHours={usage.limitHours} hosted={hosted} plan={workspace.plan} manage={canManage(role)} />
          </div>
        </nav>

        <section className="min-w-0 flex-1">
          <MobileNav
            spaces={spaces}
            active={view.kind === "archive" ? "archive" : (spaceId ?? "mine")}
            onPick={(target) =>
              void navigate({
                search: target === "mine" ? {} : target === "archive" ? { view: "archive" } : { view: "space", space: target },
              })
            }
          />
          <label className="relative mb-4 block sm:hidden">
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search videos"
              aria-label="Search videos"
              className="w-full rounded-lg border border-neutral-200 bg-white py-2 pr-3 pl-9 text-sm"
            />
          </label>

          {flaggedCount > 0 && view.kind !== "archive" && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {flaggedCount === 1 ? "1 video" : `${flaggedCount} videos`} nobody has watched in a while will be removed soon on the free plan. Open the menu on a video and choose Keep, download it, or{" "}
              <a href="/settings?tab=billing" className="font-semibold underline">
                upgrade to keep everything
              </a>
              .
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              {currentFolder && (
                <button
                  type="button"
                  onClick={() => void navigate({ search: (prev) => ({ ...prev, folder: undefined }) })}
                  className="mb-1 text-xs text-neutral-500 hover:text-neutral-800"
                >
                  ← {currentSpace?.name ?? "My videos"}
                </button>
              )}
              <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900">{heading}</h1>
              <p className="mt-0.5 text-sm text-neutral-500">
                {videos.length} {videos.length === 1 ? "video" : "videos"}
                {currentSpace && !currentFolder && " · everyone in the workspace can see these"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {currentFolder && (
                <>
                  <button type="button" onClick={() => void renameFolder(currentFolder)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
                    Rename
                  </button>
                  <button type="button" onClick={() => void deleteFolder(currentFolder)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
                    Delete folder
                  </button>
                </>
              )}
              {(view.kind === "mine" || view.kind === "space") && !currentFolder && (
                <button
                  type="button"
                  onClick={() => void newFolder()}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                >
                  <FolderPlusIcon size={16} /> New folder
                </button>
              )}
              {videos.filter((video) => video.status === "ready" && !video.deletedAt).length > 1 && view.kind !== "archive" && (
                <button
                  type="button"
                  onClick={() => {
                    setCombining((value) => !value)
                    setPicked([])
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                >
                  <FilmStripIcon size={16} /> {combining ? "Cancel combine" : "Combine videos"}
                </button>
              )}
              {videos.length > 0 && view.kind !== "archive" && (
                <button
                  type="button"
                  title="Downloads every video shown here. Your browser may ask to allow multiple downloads."
                  onClick={() => downloadAll(videos)}
                  className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                >
                  Download all
                </button>
              )}
            </div>
          </div>

          {(view.kind === "mine" || view.kind === "space") && !currentFolder && placeFolders.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {placeFolders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => void navigate({ search: (prev) => ({ ...prev, folder: folder.id }) })}
                    className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
                  >
                    <FolderIcon size={16} weight="fill" className="text-neutral-400" /> {folder.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {videos.length === 0 ? (
            <EmptyState view={view} spaceId={spaceId} />
          ) : (
            <ul className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {videos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  mine={video.ownerId === user.sub || canManage(role)}
                  showOwner={video.ownerId !== user.sub}
                  onDeleted={() => setVideos((items) => items.filter((item) => item.id !== video.id))}
                  onPatch={(changes, remove) => void patchVideo(video, changes, remove)}
                  onMove={() => setMoving(video)}
                  pick={combining ? { index: picked.indexOf(video.id), disabled: video.status !== "ready" || Boolean(video.deletedAt) } : null}
                  onTogglePick={() => togglePick(video.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      {combining && (
        <div className="pop-in fixed inset-x-0 bottom-4 z-30 mx-auto flex w-[min(92vw,34rem)] items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-xl">
          <p className="min-w-0 text-sm text-neutral-700">
            {picked.length < 2 ? "Pick two or more videos. They play in the order you pick them." : `${picked.length} videos, joined in the order picked.`}
          </p>
          <button
            type="button"
            disabled={picked.length < 2 || combineBusy}
            onClick={() => void combine()}
            className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"
          >
            {combineBusy ? "Starting…" : "Combine"}
          </button>
        </div>
      )}
    </main>
  )
}

function NavLink({ active, icon, onClick, children }: { active: boolean; icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm ${
        active ? "bg-neutral-200/70 font-medium text-neutral-900" : "text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      <span className="shrink-0 text-neutral-500">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  )
}

function MobileNav({ spaces, active, onPick }: { spaces: Array<Space>; active: string; onPick: (target: string) => void }) {
  const items = [{ id: "mine", name: "My videos" }, ...spaces.map((space) => ({ id: space.id, name: space.name })), { id: "archive", name: "Archive" }]
  return (
    <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:hidden">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item.id)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${active === item.id ? "bg-neutral-900 text-white" : "border border-neutral-200 bg-white text-neutral-700"}`}
        >
          {item.name}
        </button>
      ))}
    </div>
  )
}

function UsageMeter({ usedHours, limitHours, hosted, plan, manage }: { usedHours: number; limitHours: number | null; hosted: boolean; plan: string; manage: boolean }) {
  if (!hosted || limitHours === null) return null
  const fraction = Math.min(1, usedHours / limitHours)
  const full = fraction >= 1
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-neutral-800">Library</span>
        <span className="text-neutral-500 tabular-nums">
          {formatHours(usedHours)} of {formatHours(limitHours)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${full ? "bg-red-600" : fraction > 0.8 ? "bg-amber-500" : "bg-neutral-800"}`} style={{ width: `${Math.max(2, fraction * 100)}%` }} />
      </div>
      {manage && (full || fraction > 0.8 || plan === "free") && (
        <a href="/settings?tab=billing" className="mt-2 block text-xs font-medium text-red-600 hover:underline">
          {full ? "Library full. Add hours" : plan === "free" ? "Upgrade for more hours" : "Add hours"}
        </a>
      )}
    </div>
  )
}

function WorkspaceSwitcher({ current, name, memberships }: { current: string; name: string; memberships: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  async function pick(id: string) {
    if (id === current) return setOpen(false)
    await fetch("/api/workspace/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
    window.location.href = "/"
  }
  async function create() {
    const workspaceName = prompt("Name the new workspace")?.trim()
    if (!workspaceName) return
    const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: workspaceName }) })
    if (response.ok) window.location.href = "/settings?tab=members"
  }
  return (
    <div ref={ref} className="relative min-w-0 shrink">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex max-w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-neutral-100">
        <Logo />
        <span className="truncate text-sm font-semibold tracking-tight text-neutral-900">{name}</span>
        <CaretDownIcon size={12} className="shrink-0 text-neutral-500" />
      </button>
      {open && (
        <div className="pop-in absolute top-11 left-0 z-30 w-64 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
          {memberships.map((membership) => (
            <button
              key={membership.id}
              type="button"
              onClick={() => void pick(membership.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100"
            >
              <span className="truncate">{membership.name}</span>
              {membership.id === current && <CheckIcon size={14} className="shrink-0" />}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-100" />
          <a href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
            <GearSixIcon size={16} /> Workspace settings
          </a>
          <button type="button" onClick={() => void create()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100">
            <PlusIcon size={16} /> New workspace
          </button>
        </div>
      )}
    </div>
  )
}

function AccountMenu({ name, avatar }: { name: string; avatar: string }) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`Account: ${name}`} onClick={() => setOpen((value) => !value)}>
        <img src={avatar} alt="" className="size-8 rounded-full ring-1 ring-neutral-200" />
      </button>
      {open && (
        <div className="pop-in absolute top-11 right-0 z-30 w-52 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
          <p className="truncate px-3 py-2 text-xs text-neutral-500">Signed in as {name}</p>
          <a href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
            <GearSixIcon size={16} /> Settings
          </a>
          <button
            type="button"
            onClick={() => void authClient.signOut().then(() => window.location.reload())}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <SignOutIcon size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close()
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, close])
  return ref
}

function EmptyState({ view, spaceId }: { view: LibraryView; spaceId: string | null }) {
  if (view.kind === "search") return <p className="mt-10 text-sm text-neutral-500">No video mentions “{view.query}”.</p>
  if (view.kind === "archive")
    return <p className="mt-10 text-sm text-neutral-500">Archived videos land here. They keep their links; they just leave your main library.</p>
  if (view.folderId) return <p className="mt-10 text-sm text-neutral-500">This folder is empty. Use Move on any video to put it here.</p>
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center">
      <p className="text-lg font-medium text-neutral-800">{spaceId ? "Nothing in this space yet" : "Your first video is one click away"}</p>
      <p className="mt-1 text-sm text-neutral-500">
        {spaceId ? "Record straight into it, or move a video here from your library." : "Record your screen and camera. The link is ready the second you stop."}
      </p>
      <a
        href={spaceId ? `/record?space=${spaceId}` : "/record"}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
      >
        <span className="size-2 rounded-full bg-white" /> Record a video
      </a>
    </div>
  )
}

function MoveDialog({
  video,
  spaces,
  folders,
  onClose,
  onMove,
}: {
  video: LibraryVideo
  spaces: Array<Space>
  folders: Array<Folder>
  onClose: () => void
  onMove: (changes: { spaceId: string | null; folderId: string | null }) => void
}) {
  const [spaceId, setSpaceId] = useState<string | null>(video.spaceId)
  const [folderId, setFolderId] = useState<string | null>(video.folderId)
  const choices = folders.filter((folder) => (spaceId ? folder.spaceId === spaceId : !folder.spaceId))
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="move-title" className="pop-in w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 id="move-title" className="text-lg font-semibold text-neutral-900">
          Move “{video.title || "Untitled video"}”
        </h2>
        <p className="mt-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Library</p>
        <div className="mt-1.5 space-y-1">
          {[{ id: null, name: "My videos" }, ...spaces.map((space) => ({ id: space.id, name: space.name }))].map((place) => (
            <label key={place.id ?? "mine"} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50">
              <input
                type="radio"
                name="move-space"
                checked={spaceId === place.id}
                onChange={() => {
                  setSpaceId(place.id)
                  setFolderId(null)
                }}
              />
              {place.id ? <UsersThreeIcon size={16} className="text-neutral-500" /> : <UserIcon size={16} className="text-neutral-500" />}
              {place.name}
            </label>
          ))}
        </div>
        {choices.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Folder</p>
            <select
              value={folderId ?? ""}
              onChange={(event) => setFolderId(event.target.value || null)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">No folder</option>
              {choices.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </>
        )}
        {spaceId && <p className="mt-3 text-xs text-neutral-500">Everyone in the workspace will see it in this space.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onMove({ spaceId, folderId })}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  )
}

function VideoCard({
  video,
  mine,
  showOwner,
  onDeleted,
  onPatch,
  onMove,
  pick,
  onTogglePick,
}: {
  video: LibraryVideo
  mine: boolean
  showOwner: boolean
  onDeleted: () => void
  onPatch: (changes: Record<string, unknown>, remove: boolean) => void
  onMove: () => void
  /** Set while combining: this card's place in the pick order (-1 when not picked). */
  pick: { index: number; disabled: boolean } | null
  onTogglePick: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useOutsideClose(menu, () => setMenu(false))
  const title =
    video.title ||
    (video.aiStatus === "pending" ? "Naming your video…" : "Untitled video")
  const ready = video.status === "ready" && !video.deletedAt
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
  return (
    <li className="group relative rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <a
        href={`/${video.id}`}
        className="relative block aspect-video overflow-hidden rounded-t-xl bg-neutral-200"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={(event) => {
          if (!pick) return
          event.preventDefault()
          if (!pick.disabled) onTogglePick()
        }}
      >
        {pick && (
          <span
            className={`absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full text-sm font-bold shadow ${
              pick.index >= 0 ? "bg-red-600 text-white" : pick.disabled ? "bg-white/50 text-transparent" : "bg-white/90 text-transparent ring-2 ring-neutral-400"
            }`}
          >
            {pick.index >= 0 ? pick.index + 1 : "·"}
          </span>
        )}
        {video.posterKey && (
          <img src={`/api/poster/${video.id}`} alt="" loading="lazy" className={`size-full object-cover ${video.deletedAt ? "opacity-40 grayscale" : ""}`} />
        )}
        {hovering && ready && (
          // Hover preview straight from R2; range requests mean it only fetches what plays.
          <video
            src={`/api/media/${video.id}#t=1`}
            muted
            autoPlay
            loop
            playsInline
            className="absolute inset-0 size-full bg-black object-cover"
          />
        )}
        {video.duration != null && (
          <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatDuration(video.duration)}
          </span>
        )}
        <span className="absolute top-2 left-2 flex flex-wrap gap-1">
          {video.requestId && <Badge tone="dark">Requested</Badge>}
          {video.status === "importing" && <Badge tone="dark">Bringing it over…</Badge>}
          {video.status === "rendering" && <Badge tone="dark">Combining clips…</Badge>}
          {video.status === "failed" && <Badge tone="red">Import failed</Badge>}
          {video.status === "recording" && (
            <Badge tone="red">
              <span className="size-1.5 animate-pulse rounded-full bg-white" /> Recording
            </Badge>
          )}
          {video.deletedAt && <Badge tone="dark">Removed: nobody watched it</Badge>}
          {!video.deletedAt && video.retentionNoticeAt && <Badge tone="amber">Will be removed soon</Badge>}
          {video.visibility === "workspace" && <Badge tone="dark">Members only</Badge>}
        </span>
      </a>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <a href={`/${video.id}`} className="block truncate font-medium text-neutral-900">
            {title}
          </a>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {showOwner && video.ownerName ? `${video.ownerName} · ` : ""}
            {formatTimeAgo(video.createdAt)} · {formatViews(video.views)}
          </p>
          {video.snippet && <p className="mt-1.5 line-clamp-2 text-xs text-neutral-600">{video.snippet}</p>}
        </div>
        <div ref={menuRef} className="relative flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/${video.id}`)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          {mine && (
            <button
              type="button"
              aria-label="More"
              aria-expanded={menu}
              onClick={() => setMenu((open) => !open)}
              className="rounded-md px-1.5 py-1 text-neutral-500 hover:bg-neutral-100"
            >
              ⋯
            </button>
          )}
          {menu && (
            <div className="pop-in absolute right-0 bottom-9 z-10 w-48 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
              {(video.deletedAt || video.retentionNoticeAt) && (
                <button type="button" className={item} onClick={() => (setMenu(false), onPatch({ keep: true }, Boolean(video.deletedAt)))}>
                  {video.deletedAt ? "Restore" : "Keep"}
                </button>
              )}
              {!video.deletedAt && (
                <>
                  <button type="button" className={item} onClick={() => (setMenu(false), onMove())}>
                    Move…
                  </button>
                  <button type="button" className={item} onClick={() => (setMenu(false), onPatch({ archived: !video.archivedAt }, true))}>
                    {video.archivedAt ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    type="button"
                    className={item}
                    onClick={() => (setMenu(false), onPatch({ visibility: video.visibility === "workspace" ? "link" : "workspace" }, false))}
                  >
                    {video.visibility === "workspace" ? "Anyone with the link" : "Members only"}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenu(false)
                  if (!confirm(`Delete “${title}”? This can't be undone.`)) return
                  void fetch(`/api/recordings/${video.id}`, { method: "DELETE" }).then((response) => {
                    if (response.ok) onDeleted()
                  })
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function Badge({ tone, children }: { tone: "dark" | "red" | "amber"; children: React.ReactNode }) {
  const tones = { dark: "bg-neutral-900/80 text-white", red: "bg-red-600 text-white", amber: "bg-amber-400 text-amber-950" }
  return <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

/** Your library is yours: every original file, no export ticket required. */
function downloadAll(videos: Array<LibraryVideo>) {
  const ready = videos.filter((video) => video.status === "ready")
  ready.forEach((video, index) => {
    setTimeout(() => {
      const link = document.createElement("a")
      link.href = `/api/media/${video.id}`
      const name = (video.title || video.id).replace(/[^\w\- ]+/g, "").trim() || video.id
      link.download = `${name}.mp4`
      link.click()
    }, index * 800)
  })
}

function Logo() {
  return (
    <span className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-pink-500">
      <span className="size-2.5 rounded-full bg-white" />
    </span>
  )
}
