import { FirstVideo, LibraryNextStep, LibraryControls, sortLibraryVideos, useLibraryPresentation } from "@/components/library-controls"
import type { LibraryLayout } from "@/components/library-controls"
import { CommandPaletteButton } from "@/components/command-palette"
import { libraryUrl, validateLibrarySearch } from "@/lib/library-search"
import type { LibrarySearch } from "@/lib/library-search"
import { BrandMark } from "@/components/brand-mark"
import { VertovIcon } from "@/components/vertov-icon"
import { ANALYTICS_LOADED, identifyUser } from "@/lib/posthog"
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import {
  ChartBarIcon,
  ArchiveIcon,
  ClockIcon,
  CaretDownIcon,
  CheckIcon,
  FilmStripIcon,
  PlayIcon,
  EyeIcon,
  CopyIcon,
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
import { CreateSpaceDialog } from "@/components/create-space-dialog"
import { getSessionUser, googleClientId } from "@/lib/auth.server"
import { authClient } from "@/lib/auth-client"
import { APP_NAME } from "@/lib/brand"
import { HOSTED_EDITION } from "@/lib/edition"
import { formatDuration, formatTimeAgo, formatViews } from "@/lib/format"
import { flaggedVideos, listFolders, listLibrary, listSpaces } from "@/lib/library.server"
import { SaveAccountBanner } from "@/components/save-account"
import { canManage, formatHours } from "@/lib/plans"
import { getWorkspaceContext, isHosted, toPublicWorkspace, usageOf } from "@/lib/workspace.server"

type LibraryDeps = LibrarySearch

const loadLibrary = createServerFn({ method: "GET" })
  .validator((deps: LibraryDeps) => deps)
  .handler(async ({ data }) => {
    const request = getRequest()
    const user = await getSessionUser(request)
    const origin = new URL(request.url).origin
    if (!user) return { user: null } as const
    const { workspace, role, memberships } = await getWorkspaceContext(request, user)
    const spaces = await listSpaces(workspace.id)
    const space = data.view === "space" ? (spaces.find((item) => item.id === data.space) ?? null) : null
    const view: LibraryView = data.q
      ? { kind: "search", query: data.q }
      : data.view === "archive"
        ? { kind: "archive" }
        : data.view === "later"
          ? { kind: "later" }
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
      googleEnabled: Boolean(googleClientId()),
      usage: { usedHours: usage.usedHours, limitHours: Number.isFinite(usage.limitHours) ? usage.limitHours : null },
    } as const
  })

export const Route = createFileRoute("/app")({
  validateSearch: validateLibrarySearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const data = await loadLibrary({ data: deps })
    if (!data.user) throw redirect({ to: "/signin", search: { redirect: libraryUrl(deps) } })
    return data
  },
  head: () => ({ meta: [{ title: `My library · ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: LibraryPage,
})

function LibraryPage() {
  return <Library data={Route.useLoaderData()} />
}

type LoadedLibrary = Exclude<Awaited<ReturnType<typeof loadLibrary>>, { user: null }>

function Library({ data }: { data: LoadedLibrary }) {
  const { user, workspace, role, memberships, spaces, folders, view, usage, hosted, flaggedCount, googleEnabled } = data
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/app" })
  const router = useRouter()
  const [videos, setVideos] = useState(data.videos)
  const presentation = useLibraryPresentation()
  const orderedVideos = sortLibraryVideos(videos, presentation.sort)
  const shownDuration = videos.reduce((total, video) => total + (video.duration ?? 0), 0)
  const shownViews = videos.reduce((total, video) => total + video.views, 0)
  const [adding, setAdding] = useState(Boolean(search.import))
  const [requesting, setRequesting] = useState(Boolean(search.request))
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [query, setQuery] = useState(search.q ?? "")
  const [moving, setMoving] = useState<LibraryVideo | null>(null)
  const [listing, setListing] = useState<LibraryVideo | null>(null)
  const [combining, setCombining] = useState(false)
  const [picked, setPicked] = useState<Array<string>>([])
  const [combineBusy, setCombineBusy] = useState(false)
  useEffect(() => setVideos(data.videos), [data.videos])
  useEffect(() => {
    // Only does anything once the visitor has allowed analytics cookies.
    const identify = () => identifyUser(user.sub)
    identify()
    addEventListener(ANALYTICS_LOADED, identify)
    return () => removeEventListener(ANALYTICS_LOADED, identify)
  }, [user.sub])
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
        : view.kind === "later"
          ? "Watch later"
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

  return (
    <main className="library-shell min-h-dvh">
      <SaveAccountBanner google={googleEnabled} />
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-3 px-4 lg:px-8">
        <a href="/app" aria-label="Vertov home"><BrandMark size={28} /></a>
        <WorkspaceSwitcher current={workspace.id} name={workspace.name} memberships={memberships} />
        <label className="relative ml-2 hidden max-w-md flex-1 sm:block">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and what was said"
            aria-label="Search videos"
            className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pr-3 pl-9 text-sm focus:border-neutral-400 focus:outline-none"
          />
        </label>
        <CommandPaletteButton />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="hidden rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 sm:block"
          >
            {HOSTED_EDITION ? "Upload or import" : "Upload"}
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
        </div>
      </header>

      {requesting && <RequestDialog onClose={() => setRequesting(false)} />}
      {adding && <ImportDialog onClose={() => setAdding(false)} onImported={refresh} />}
      {creatingSpace && <CreateSpaceDialog workspaceName={workspace.name} onClose={() => setCreatingSpace(false)} onCreated={(id) => {
        setCreatingSpace(false)
        void navigate({ search: { view: "space", space: id } })
      }} />}
      {listing && <AddToPlaylistDialog video={listing} onClose={() => setListing(null)} />}
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

      <div className="mx-auto flex max-w-[1480px] gap-8 px-4 py-8 lg:gap-12 lg:px-8">
        <nav aria-label="Library" className="hidden w-48 shrink-0 md:block">
          <div className="sticky top-20 space-y-6">
            <div className="space-y-0.5">
              <NavLink active={view.kind === "mine" && !folderId} icon={<UserIcon size={16} />} onClick={() => void navigate({ search: {} })}>
                My videos
              </NavLink>
              <NavLink active={view.kind === "later"} icon={<ClockIcon size={16} />} onClick={() => void navigate({ search: { view: "later" } })}>
                Watch later
              </NavLink>
              <NavLink active={view.kind === "archive"} icon={<ArchiveIcon size={16} />} onClick={() => void navigate({ search: { view: "archive" } })}>
                Archive
              </NavLink>
              {HOSTED_EDITION && <a href="/playlists" className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/60"><VertovIcon name="playlist" size={16} /> Playlists</a>}
              {HOSTED_EDITION && canManage(role) && <a href="/analytics" className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/60"><ChartBarIcon size={16} /> Analytics</a>}
              {HOSTED_EDITION && canManage(role) && <a href="/tutorials" className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/60"><VertovIcon name="tutorial" size={16} /> Tutorials</a>}
            </div>
            <div>
              <div className="flex items-center justify-between px-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                Spaces
                {canManage(role) && (
                  <button type="button" aria-label="New space" onClick={() => setCreatingSpace(true)} className="rounded p-0.5 hover:bg-neutral-200">
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
            manage={canManage(role)}
            spaces={spaces}
            active={view.kind === "archive" ? "archive" : view.kind === "later" ? "later" : (spaceId ?? "mine")}
            onPick={(target) =>
              void navigate({
                search: target === "mine" ? {} : target === "archive" ? { view: "archive" } : target === "later" ? { view: "later" } : { view: "space", space: target },
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
              <h1 className="library-heading truncate">{heading}</h1>
              <p className="mt-0.5 text-sm text-neutral-500">
                {videos.length} {videos.length === 1 ? "video" : "videos"}
                {shownDuration > 0 && <span title="Combined duration of the videos shown"> · {formatDuration(shownDuration)} total</span>}
                {shownViews > 0 && <> · {formatViews(shownViews)}</>}
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
              {HOSTED_EDITION && videos.filter((video) => video.status === "ready" && !video.deletedAt).length > 1 && view.kind !== "archive" && (
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
            <EmptyState view={view} spaceId={spaceId} onUpload={() => setAdding(true)} onRequest={() => setRequesting(true)} onBrowse={() => void navigate({ search: {} })} />
          ) : (
            <>
            <LibraryControls {...presentation} />
            <ul aria-label="Recordings" className={presentation.layout === "grid" ? "mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" : "mt-5 flex flex-col gap-3"}>
              {orderedVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  layout={presentation.layout}
                  mine={video.ownerId === user.sub || canManage(role)}
                  showOwner={video.ownerId !== user.sub}
                  onDeleted={() => setVideos((items) => items.filter((item) => item.id !== video.id))}
                  onPatch={(changes, remove) => void patchVideo(video, changes, remove)}
                  onMove={() => setMoving(video)}
                  onAddToPlaylist={() => setListing(video)}
                  pick={combining ? { index: picked.indexOf(video.id), disabled: video.status !== "ready" || Boolean(video.deletedAt) } : null}
                  onTogglePick={() => togglePick(video.id)}
                />
              ))}
            </ul>
            {view.kind === "mine" && !folderId && videos.length <= 3 && !combining && <LibraryNextStep onUpload={() => setAdding(true)} onRequest={() => setRequesting(true)} />}
            </>
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
        active ? "bg-neutral-200/70 font-medium text-neutral-900" : "text-neutral-600 hover:bg-neutral-200/60"
      }`}
    >
      <span className="shrink-0 text-neutral-500">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  )
}

function MobileNav({ spaces, active, onPick, manage }: { manage: boolean; spaces: Array<Space>; active: string; onPick: (target: string) => void }) {
  const items = [{ id: "mine", name: "My videos" }, { id: "later", name: "Watch later" }, ...spaces.map((space) => ({ id: space.id, name: space.name })), { id: "archive", name: "Archive" }]
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
      {HOSTED_EDITION && manage && <a href="/analytics" className="shrink-0 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700">Analytics</a>}
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
    window.location.href = "/app"
  }
  async function create() {
    const workspaceName = prompt("Name the new workspace")?.trim()
    if (!workspaceName) return
    const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: workspaceName }) })
    if (response.ok) window.location.href = "/settings?tab=members"
  }
  return (
    <div ref={ref} className="relative min-w-0 shrink">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex max-w-full min-w-0 items-center gap-2 rounded-lg py-1 pr-3 pl-1.5 hover:bg-neutral-100">
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

function EmptyState({ view, spaceId, onUpload, onRequest, onBrowse }: { view: LibraryView; spaceId: string | null; onUpload: () => void; onRequest: () => void; onBrowse: () => void }) {
  if ((view.kind === "mine" || view.kind === "space") && !view.folderId) return <FirstVideo spaceId={spaceId} onUpload={onUpload} onRequest={onRequest} onBrowse={onBrowse} />
  const title = view.kind === "search" ? "No matches yet" : view.kind === "archive" ? "Nothing tucked away" : view.kind === "later" ? "Save something for later" : "A little room to organize"
  const detail = view.kind === "search" ? `No video mentions “${view.query}”. Try a shorter phrase or a few words from the recording.` : view.kind === "archive" ? "Archive videos from their menu to clear your library without changing their share links." : view.kind === "later" ? "Choose Watch later on a video’s share page. It will be waiting here." : "Use Move from a video’s menu to bring it into this folder."
  return <div className="library-empty"><FilmStripIcon size={36} className="mb-4 text-neutral-400" /><h2 className="text-xl font-semibold tracking-tight text-neutral-900">{title}</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-500">{detail}</p><button type="button" onClick={onBrowse} className="mt-5 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">Back to my videos</button></div>
}

function AddToPlaylistDialog({ video, onClose }: { video: LibraryVideo; onClose: () => void }) {
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string; count: number }> | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    void fetch("/api/playlists")
      .then((response) => response.json() as Promise<{ playlists?: Array<{ id: string; title: string; count: number }> }>)
      .then((body) => setPlaylists(body.playlists ?? []), () => setPlaylists([]))
  }, [])

  async function add(playlistId: string) {
    const response = await fetch(`/api/playlists/${playlistId}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId: video.id }) }).catch(() => null)
    if (response?.ok) return setAdded((current) => new Set(current).add(playlistId))
    const body = (await response?.json().catch(() => null)) as { error?: string } | null
    setError(body?.error ?? "Couldn't add it. Try again.")
  }

  async function createAndAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const response = await fetch("/api/playlists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { playlist?: { id: string; title: string; count: number }; error?: string } | null
    if (!body?.playlist) return setError(body?.error ?? "Couldn't create the playlist")
    const created = body.playlist
    setPlaylists((current) => [created, ...(current ?? [])])
    setTitle("")
    await add(created.id)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="playlist-title" className="pop-in w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 id="playlist-title" className="text-lg font-semibold text-neutral-900">
          Add “{video.title || "Untitled video"}” to a playlist
        </h2>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {playlists === null && <li className="h-9 animate-pulse rounded-lg bg-neutral-100" />}
          {playlists?.length === 0 && <li className="text-sm text-neutral-500">No playlists yet. Name one below.</li>}
          {playlists?.map((playlist) => (
            <li key={playlist.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
              <VertovIcon name="playlist" size={16} />
              <span className="min-w-0 flex-1 truncate text-sm">{playlist.title}</span>
              {added.has(playlist.id) ? (
                <span className="text-xs font-medium text-emerald-700">Added</span>
              ) : (
                <button type="button" onClick={() => void add(playlist.id)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-100">
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={(event) => void createAndAdd(event)} className="mt-3 flex gap-2">
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="New playlist" aria-label="New playlist name" className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          <button type="submit" disabled={!title.trim()} className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Create
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-between gap-2">
          <a href="/playlists" className="rounded-lg px-2 py-2 text-sm text-neutral-600 hover:underline">
            Manage playlists
          </a>
          <button type="button" onClick={onClose} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
            Done
          </button>
        </div>
      </div>
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
  layout,
  mine,
  showOwner,
  onDeleted,
  onPatch,
  onMove,
  onAddToPlaylist,
  pick,
  onTogglePick,
}: {
  video: LibraryVideo
  layout: LibraryLayout
  mine: boolean
  showOwner: boolean
  onDeleted: () => void
  onPatch: (changes: Record<string, unknown>, remove: boolean) => void
  onMove: () => void
  onAddToPlaylist: () => void
  /** Set while combining: this card's place in the pick order (-1 when not picked). */
  pick: { index: number; disabled: boolean } | null
  onTogglePick: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [previewAllowed, setPreviewAllowed] = useState(false)
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)")
    const update = () => setPreviewAllowed(!motion.matches && pointer.matches)
    update(); motion.addEventListener("change", update); pointer.addEventListener("change", update)
    return () => { motion.removeEventListener("change", update); pointer.removeEventListener("change", update) }
  }, [])
  const [hovering, setHovering] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useOutsideClose(menu, () => setMenu(false))
  const title =
    video.title ||
    (video.aiStatus === "pending" ? "Naming your video…" : "Untitled video")
  const ready = video.status === "ready" && !video.deletedAt
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
  return (
    <li className={`library-video-card group relative ${layout === "list" ? "is-list" : ""}`}>
      <a
        href={`/${video.id}`}
        aria-label={`Open ${title}`}
        className="library-thumbnail relative block aspect-video overflow-hidden"
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
        {!video.posterKey && <div className="library-poster-placeholder"><span className="library-frame-corner" /><FilmStripIcon size={36} weight="thin" /><span className="library-frame-label">{video.deletedAt ? "Recording unavailable" : video.status === "ready" ? "Ready to share" : "Getting ready"}</span></div>}
        {video.posterKey && (
          <img src={`/api/poster/${video.id}`} alt="" loading="lazy" className={`size-full object-cover ${video.deletedAt ? "opacity-40 grayscale" : ""}`} />
        )}
        {hovering && ready && previewAllowed && (
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
        {ready && !pick && <span className="library-play-cue" aria-hidden="true"><PlayIcon size={20} weight="fill" /></span>}
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
      <div className="library-card-body flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <a href={`/${video.id}`} title={title} className="line-clamp-2 text-sm leading-snug font-semibold text-neutral-900 hover:text-red-700">
            {title}
          </a>
          <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-neutral-500">
            {showOwner && video.ownerName ? `${video.ownerName} · ` : ""}
            {formatTimeAgo(video.createdAt)} <span aria-hidden="true">·</span> <EyeIcon size={12} /> {formatViews(video.views)}
          </p>
          {video.snippet && <p className="mt-1.5 line-clamp-2 text-xs text-neutral-600">{video.snippet}</p>}
        </div>
        <div ref={menuRef} className="relative flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Copy link to ${title}`}
            onClick={async () => {
              setCopied(false)
              setCopyError(false)
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/${video.id}`)
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              } catch { setCopyError(true) }
            }}
            title={copyError ? "Couldn’t copy. Open the video and copy its address." : "Copy share link"}
            className={`library-copy-button ${copied ? "is-copied" : ""}`}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}<span>{copied ? "Copied" : copyError ? "Try again" : "Copy link"}</span>
          </button>
          <span className="sr-only" role="status">{copied ? "Link copied" : copyError ? "Couldn't copy the link. Open the video and copy its address." : ""}</span>
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
                  <a href={`/${video.id}?panel=insights`} className={item}>View analytics</a>
                  <button type="button" className={item} onClick={() => (setMenu(false), onMove())}>
                    Move…
                  </button>
                  {HOSTED_EDITION && (
                    <button type="button" className={item} onClick={() => (setMenu(false), onAddToPlaylist())}>
                      Add to playlist…
                    </button>
                  )}
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
