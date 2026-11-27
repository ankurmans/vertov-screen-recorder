import { noteLifecycleEvent } from "@/lib/lifecycle-events.server";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import {
  CaretDownIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  FilmStripIcon,
  FolderIcon,
  FolderPlusIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
  SignOutIcon,
} from "@phosphor-icons/react"
import { Suspense, lazy, useEffect, useRef, useState } from "react"

const RecorderPanel = lazy(() => import("@/components/recorder").then((module) => ({ default: module.Recorder })))
import type { LibraryLayout } from "@/components/library-controls"
import type { LibrarySearch } from "@/lib/library-search"
import type { Folder, Space } from "@/db/schema"
import type { LibraryVideo, LibraryView } from "@/lib/library.server"
import { captureServer } from "@/lib/posthog.server"
import { LibraryGuide, markGuide } from "@/components/library-guide"
import { ReviewPrompt } from "@/components/review-prompt"
import { filterLibraryVideos, FirstVideo, LibraryControls, LibraryNextStep, sortLibraryVideos, useLibraryPresentation } from "@/components/library-controls"
import { CommandPaletteButton } from "@/components/command-palette"
import { libraryUrl, validateLibrarySearch } from "@/lib/library-search"
import { BrandMark } from "@/components/brand-mark"
import { LibrarySidebar, openPanel } from "@/components/library-sidebar"
import { askConfirm, askText } from "@/components/app-dialog"
import { ImportDialog } from "@/components/import-dialog"
import { RequestDialog } from "@/components/request-dialog"
import { CreateSpaceDialog } from "@/components/create-space-dialog"
import { MoveDialog } from "@/components/move-dialog"
import { getSessionUser, googleClientId } from "@/lib/auth.server"
import { authClient } from "@/lib/auth-client"
import { APP_NAME } from "@/lib/brand"
import { HOSTED_EDITION } from "@/lib/edition"
import { formatDuration, formatTimeAgo } from "@/lib/format"
import { libraryReader, listFolders, listLibrary, listSpaces } from "@/lib/library.server"
import { SaveAccountBanner } from "@/components/save-account"
import { canManage } from "@/lib/plans"
import { isUnclaimedGuest } from "@/lib/access.server"
import { getWorkspaceContext, toPublicWorkspace } from "@/lib/workspace.server"
import { translatorFromMatches, useLanguage, useLanguageTag, useT } from "@/lib/i18n/react"
import { localizedTimeAgo, localizedViews } from "@/lib/i18n/format"

type LibraryDeps = LibrarySearch

const loadLibrary = createServerFn({ method: "GET" })
  .validator((data: LibraryDeps) => data)
  .handler(({ data }) => readLibrary(data))

async function readLibrary(data: LibraryDeps) {
  const request = getRequest()
  const user = await getSessionUser(request)
  const origin = new URL(request.url).origin
  if (!user) return { user: null } as const
  const { workspace, role, memberships } = await getWorkspaceContext(request, user)
  await noteLifecycleEvent(user.sub, "active")
  captureServer("library_opened", user.sub, { view: data.view ?? "mine", searching: Boolean(data.q) })
  // The existing spaces read anchors this request at the primary before any reads can use replicas.
  const reader = libraryReader()
  const spaces = await listSpaces(workspace.id, reader)
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
  const [videos, folders] = await Promise.all([
    listLibrary(workspace.id, user.sub, view, undefined, reader),
    listFolders(workspace.id, user.sub, reader),
  ])
  return {
    user,
    origin,
    dateReference: Date.now(),
    workspace: toPublicWorkspace(workspace),
    role,
    memberships,
    spaces,
    folders,
    videos,
    view,
    googleEnabled: Boolean(googleClientId()),
    guest: await isUnclaimedGuest(user.sub),
  } as const
}

export const Route = createFileRoute("/home")({
  validateSearch: validateLibrarySearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const data = await loadLibrary({ data: deps })
    if (!data.user) throw redirect({ to: "/signin", search: { redirect: libraryUrl(deps) } })
    return data
  },
  head: ({ matches }) => ({ meta: [{ title: translatorFromMatches(matches)("library.page.title", { app: APP_NAME }) }, { name: "robots", content: "noindex" }] }),
  component: LibraryPage,
})

function LibraryPage() {
  return <Library data={Route.useLoaderData()} />
}

type LoadedLibrary = Exclude<Awaited<ReturnType<typeof loadLibrary>>, { user: null }>

function Library({ data }: { data: LoadedLibrary }) {
  const { user, workspace, role, memberships, spaces, folders, view, googleEnabled } = data
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/home" })
  const router = useRouter()
  const t = useT()
  const language = useLanguage()
  const languageTag = useLanguageTag()
  const [videos, setVideos] = useState(data.videos)
  const [recording, setRecording] = useState<"rail" | "top" | null>(null)
  const presentation = useLibraryPresentation()
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  // The server and browser use the same snapshot while React hydrates the library.
  const initialDateReference = hydrated ? undefined : { now: data.dateReference, locale: languageTag, timeZone: "UTC" }
  const orderedVideos = sortLibraryVideos(filterLibraryVideos(videos, presentation.filters), presentation.sort)
  const shownDuration = videos.reduce((total, video) => total + (video.duration ?? 0), 0)
  const shownViews = videos.reduce((total, video) => total + video.views, 0)
  const [adding, setAdding] = useState<"files" | "loom" | null>(search.import ? "loom" : null)
  const [requesting, setRequesting] = useState(Boolean(search.request))
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [query, setQuery] = useState(search.q ?? "")
  const [moving, setMoving] = useState<LibraryVideo | null>(null)
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
      ? t("library.heading.results", { query: view.query })
      : view.kind === "archive"
        ? t("library.nav.archive")
        : view.kind === "later"
          ? t("library.nav.watchLater")
          : currentFolder
          ? currentFolder.name
          : currentSpace
            ? currentSpace.name
            : t("library.nav.myVideos")
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
    const name = await askText({ title: t("library.folder.newTitle"), label: t("library.folder.nameLabel"), placeholder: t("library.folder.namePlaceholder"), confirmLabel: t("library.folder.create"), maxLength: 80 })
    if (!name) return
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, spaceId }),
    })
    if (response.ok) refresh()
  }

  async function renameFolder(folder: Folder) {
    const name = await askText({ title: t("library.folder.renameTitle"), label: t("library.folder.nameLabel"), initial: folder.name, confirmLabel: t("library.folder.rename"), maxLength: 80 })
    if (!name || name === folder.name) return
    await fetch(`/api/folders/${folder.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
    refresh()
  }

  async function deleteFolder(folder: Folder) {
    if (!(await askConfirm({ title: t("library.folder.deleteTitle", { name: folder.name }), body: t("library.folder.deleteBody"), confirmLabel: t("library.folder.delete"), danger: true }))) return
    await fetch(`/api/folders/${folder.id}`, { method: "DELETE" })
    void navigate({ search: (prev) => ({ ...prev, folder: undefined }) })
  }


  return (
    <main className="library-shell min-h-dvh">
      <SaveAccountBanner google={googleEnabled} hasVideo={videos.some((video) => video.status === "ready")} />
      <div className="flex">
      <LibrarySidebar
        header={
          <div className="flex flex-col gap-2 pb-1">
            <a href="/home" aria-label={t("library.header.home", { app: APP_NAME })} className="flex items-center gap-2.5 px-1.5 pt-1"><BrandMark size={30} /><span className="text-lg font-semibold tracking-tight text-neutral-900">{APP_NAME}</span></a>
            <WorkspaceSwitcher current={workspace.id} name={workspace.name} memberships={memberships} />
          </div>
        }
        data={{ spaces, manage: canManage(role) }}
        active={view.kind === "mine" && !folderId ? "mine" : view.kind === "later" ? "later" : view.kind === "archive" ? "archive" : spaceId && !folderId ? spaceId : null}
        onNewSpace={() => setCreatingSpace(true)}
        onRecord={() => setRecording("rail")}
      />
      {recording && (
        <Suspense fallback={null}>
          <RecorderPanel panel panelAnchor={recording} spaceId={spaceId ?? undefined} onClose={() => setRecording(null)} />
        </Suspense>
      )}
      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/85 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-5">
        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <a href="/home" aria-label={t("library.header.home", { app: APP_NAME })}><BrandMark size={28} /></a>
          <WorkspaceSwitcher current={workspace.id} name={workspace.name} memberships={memberships} />
        </div>
        <label className="relative hidden max-w-xl flex-1 sm:block">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("library.header.searchPlaceholder")}
            aria-label={t("library.header.searchLabel")}
            className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pr-3 pl-9 text-sm focus:border-neutral-400 focus:outline-none"
          />
        </label>
        <CommandPaletteButton />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <NewVideoMenu href={spaceId ? `/record?space=${spaceId}` : "/record"} onRecord={() => setRecording("top")} onUpload={() => setAdding("files")} onRequest={() => setRequesting(true)} />
          <AccountMenu name={user.name} avatar={user.avatar} />
        </div>
        </div>
      </header>

      {requesting && <RequestDialog onClose={() => setRequesting(false)} />}
      {adding && <ImportDialog onClose={() => setAdding(null)} onImported={refresh} />}
      {creatingSpace && <CreateSpaceDialog workspaceName={workspace.name} onClose={() => setCreatingSpace(false)} onCreated={(id) => {
        setCreatingSpace(false)
        void navigate({ search: { view: "space", space: id } })
      }} />}
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

      <div className="library-body flex">
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
              placeholder={t("library.header.searchLabel")}
              aria-label={t("library.header.searchLabel")}
              className="w-full rounded-lg border border-neutral-200 bg-white py-2 pr-3 pl-9 text-sm"
            />
          </label>

          {HOSTED_EDITION && view.kind === "mine" && !folderId && <ReviewPrompt />}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              {currentFolder && (
                <button
                  type="button"
                  onClick={() => void navigate({ search: (prev) => ({ ...prev, folder: undefined }) })}
                  className="mb-1 text-xs text-neutral-500 hover:text-neutral-800"
                >
                  ← {currentSpace?.name ?? t("library.nav.myVideos")}
                </button>
              )}
              <h1 className="library-heading truncate">{heading}</h1>
              <p className="mt-0.5 text-sm text-neutral-500">
                {t("library.count.videos", { count: videos.length })}
                {shownDuration > 0 && <span title={t("library.count.durationTitle")}> · {t("library.count.duration", { duration: formatDuration(shownDuration) })}</span>}
                {shownViews > 0 && <> · {localizedViews(shownViews, language, t)}</>}
                {currentSpace && !currentFolder && ` · ${t("library.count.spaceVisible")}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {currentFolder && (
                <>
                  <button type="button" onClick={() => void renameFolder(currentFolder)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
                    {t("library.folder.rename")}
                  </button>
                  <button type="button" onClick={() => void deleteFolder(currentFolder)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
                    {t("library.folder.delete")}
                  </button>
                </>
              )}
              {(view.kind === "mine" || view.kind === "space") && !currentFolder && (
                <button
                  type="button"
                  onClick={() => void newFolder()}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                >
                  <FolderPlusIcon size={16} /> {t("library.folder.newTitle")}
                </button>
              )}
              {videos.length > 0 && view.kind !== "archive" && (
                <button
                  type="button"
                  title={t("library.downloadAll.title")}
                  onClick={() => downloadAll(videos)}
                  className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                >
                  {t("library.downloadAll.label")}
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
            <>
            <EmptyState view={view} spaceId={spaceId} onUpload={() => setAdding("files")} onRequest={() => setRequesting(true)} onBrowse={() => void navigate({ search: {} })} />
            </>
          ) : (
            <>
            {view.kind === "mine" && !folderId && (
              <LibraryGuide videoCount={videos.length} firstReadyId={videos.find((video) => video.status === "ready" && !video.deletedAt && video.ownerId === user.sub)?.id ?? null} />
            )}
            <LibraryControls {...presentation} videos={videos} />
            <ul aria-label={t("library.list.label")} className={presentation.layout === "grid" ? "mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" : "mt-5 flex flex-col gap-3"}>
              {orderedVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  layout={presentation.layout}
                  dateReference={initialDateReference}
                  mine={video.ownerId === user.sub || canManage(role)}
                  showOwner={video.ownerId !== user.sub}
                  onDeleted={() => setVideos((items) => items.filter((item) => item.id !== video.id))}
                  onPatch={(changes, remove) => void patchVideo(video, changes, remove)}
                  onMove={() => setMoving(video)}
                />
              ))}
            </ul>
            {view.kind === "mine" && !folderId && videos.length <= 3 && <LibraryNextStep onUpload={() => setAdding("files")} onRequest={() => setRequesting(true)} />}
            </>
          )}
        </section>
      </div>
      </div>
      </div>
    </main>
  )
}

function MobileNav({ spaces, active, onPick }: { manage: boolean; spaces: Array<Space>; active: string; onPick: (target: string) => void }) {
  const t = useT()
  const items = [{ id: "mine", name: t("library.nav.myVideos") }, { id: "later", name: t("library.nav.watchLater") }, ...spaces.map((space) => ({ id: space.id, name: space.name })), { id: "archive", name: t("library.nav.archive") }]
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

function NewVideoMenu({ href, onRecord, onUpload, onRequest }: { href: string; onRecord: () => void; onUpload: () => void; onRequest: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100"
  return (
    <div ref={ref} className="relative">
      <div className="flex overflow-hidden rounded-lg bg-red-600 text-white shadow-sm">
        <a href={href} onClick={(event) => openPanel(event, onRecord)} className="flex items-center gap-2 py-1.5 pr-2.5 pl-3 text-sm font-semibold whitespace-nowrap hover:bg-red-500">
          <span className="size-2 rounded-full bg-white" /> {t("library.menu.newVideo")}
        </a>
        <button type="button" aria-label={t("library.menu.more")} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="border-l border-white/30 px-2 hover:bg-red-500">
          <CaretDownIcon size={12} />
        </button>
      </div>
      {open && (
        <div className="pop-in absolute top-11 right-0 z-30 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
          <a href={href} onClick={(event) => { setOpen(false); openPanel(event, onRecord) }} className={item}>{t("library.actions.recordVideo")}</a>
          <button type="button" className={item} onClick={() => { setOpen(false); onUpload() }}>{HOSTED_EDITION ? t("library.menu.uploadOrImport") : t("library.actions.upload")}</button>
          <button type="button" className={item} onClick={() => { setOpen(false); onRequest() }}>{t("library.actions.requestVideo")}</button>
        </div>
      )}
    </div>
  )
}

function WorkspaceSwitcher({ current, name, memberships }: { current: string; name: string; memberships: Array<{ id: string; name: string }> }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  async function pick(id: string) {
    if (id === current) return setOpen(false)
    await fetch("/api/workspace/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
    window.location.href = "/home"
  }
  async function create() {
    const workspaceName = await askText({ title: t("library.workspace.newTitle"), body: t("library.workspace.newBody"), label: t("library.workspace.nameLabel"), placeholder: t("library.workspace.namePlaceholder"), confirmLabel: t("library.workspace.create"), maxLength: 60 })
    if (!workspaceName) return
    const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: workspaceName }) })
    if (response.ok) window.location.href = "/settings?tab=members"
  }
  return (
    <div ref={ref} className="relative min-w-0 shrink md:w-full">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex max-w-full min-w-0 items-center gap-2 rounded-lg py-1 pr-3 pl-1.5 hover:bg-neutral-100">
        <span className="truncate text-sm font-semibold tracking-tight text-neutral-900">{name}</span>
        <CaretDownIcon size={12} className="shrink-0 text-neutral-500" />
      </button>
      {open && (
        <div className="pop-in absolute top-11 left-0 z-30 w-full rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
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
            <GearSixIcon size={16} /> {t("library.palette.settingsTitle")}
          </a>
          <button type="button" onClick={() => void create()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100">
            <PlusIcon size={16} /> {t("library.workspace.newTitle")}
          </button>
        </div>
      )}
    </div>
  )
}

function AccountMenu({ name, avatar }: { name: string; avatar: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={t("library.account.menuLabel", { name })} onClick={() => setOpen((value) => !value)}>
        <img src={avatar} alt="" className="size-8 rounded-full ring-1 ring-neutral-200" />
      </button>
      {open && (
        <div className="pop-in absolute top-11 right-0 z-30 w-52 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
          <p className="truncate px-3 py-2 text-xs text-neutral-500">{t("library.account.signedInAs", { name })}</p>
          <a href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
            <GearSixIcon size={16} /> {t("library.account.settings")}
          </a>
          <button
            type="button"
            onClick={() => void authClient.signOut().then(() => window.location.reload())}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <SignOutIcon size={16} /> {t("library.account.signOut")}
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
  const t = useT()
  if ((view.kind === "mine" || view.kind === "space") && !view.folderId) return <FirstVideo spaceId={spaceId} onUpload={onUpload} onRequest={onRequest} onBrowse={onBrowse} />
  const title = view.kind === "search" ? t("library.empty.searchTitle") : view.kind === "archive" ? t("library.empty.archiveTitle") : view.kind === "later" ? t("library.empty.laterTitle") : t("library.empty.folderTitle")
  const detail = view.kind === "search" ? t("library.empty.searchBody", { query: view.query }) : view.kind === "archive" ? t("library.empty.archiveBody") : view.kind === "later" ? t("library.empty.laterBody") : t("library.empty.folderBody")
  return <div className="library-empty"><FilmStripIcon size={36} className="mb-4 text-neutral-400" /><h2 className="text-xl font-semibold tracking-tight text-neutral-900">{title}</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-500">{detail}</p><button type="button" onClick={onBrowse} className="mt-5 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">{t("library.empty.back")}</button></div>
}

function VideoCard({
  video,
  layout,
  dateReference,
  mine,
  showOwner,
  onDeleted,
  onPatch,
  onMove,
}: {
  video: LibraryVideo
  layout: LibraryLayout
  dateReference: Parameters<typeof formatTimeAgo>[1]
  mine: boolean
  showOwner: boolean
  onDeleted: () => void
  onPatch: (changes: Record<string, unknown>, remove: boolean) => void
  onMove: () => void
}) {
  const t = useT()
  const language = useLanguage()
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
  const [download, setDownload] = useState<"idle" | "rendering" | "failed">("idle")
  const menuRef = useOutsideClose(menu, () => setMenu(false))
  const title =
    video.title ||
    (video.aiStatus === "pending" ? t("library.card.naming") : t("library.video.untitled"))
  const ready = video.status === "ready" && !video.deletedAt
  // The same MP4 the owner gets on the video page, with the layout rendered in; long renders are polled for.
  async function downloadVideo() {
    setDownload("rendering")
    try {
      let body = await (await fetch(`/api/recordings/${video.id}/export`, { method: "POST" })).json<{ status?: string }>()
      const started = Date.now()
      while (body.status === "pending" && Date.now() - started < 20 * 60 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 4000))
        body = await (await fetch(`/api/recordings/${video.id}/export`)).json<{ status?: string }>()
      }
      if (body.status !== "done") throw new Error("render did not finish")
      window.location.href = `/api/export/${video.id}`
      setDownload("idle")
      setMenu(false)
    } catch {
      setDownload("failed")
    }
  }
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
  return (
    <li className={`library-video-card group relative ${layout === "list" ? "is-list" : ""}`}>
      <a
        href={`/${video.id}`}
        aria-label={t("library.card.open", { title })}
        className="library-thumbnail relative block aspect-video overflow-hidden"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {!video.posterKey && <div className="library-poster-placeholder"><span className="library-frame-corner" /><FilmStripIcon size={36} weight="thin" /><span className="library-frame-label">{video.deletedAt ? t("library.card.unavailable") : video.status === "ready" ? t("library.card.readyToShare") : t("library.card.gettingReady")}</span></div>}
        {video.posterKey && (
          <img src={`/api/poster/${video.id}`} alt="" loading="lazy" className={`size-full object-cover ${video.deletedAt ? "opacity-40 grayscale" : ""}`} />
        )}
        {hovering && ready && previewAllowed && (
          // Hover preview straight from R2; range requests mean it only fetches what plays.
          <video
            src={`/api/media/${video.id}?original=1#t=1`}
            muted
            autoPlay
            loop
            playsInline
            className="absolute inset-0 size-full bg-black object-cover"
          />
        )}
        {ready && <span className="library-play-cue" aria-hidden="true"><PlayIcon size={20} weight="fill" /></span>}
        {video.duration != null && (
          <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatDuration(video.duration)}
          </span>
        )}
        <span className="absolute top-2 left-2 flex flex-wrap gap-1">
          {video.requestId && <Badge tone="dark">{t("library.card.requested")}</Badge>}
          {video.status === "importing" && <Badge tone="dark">{t("library.card.importing")}</Badge>}
          {video.status === "rendering" && <Badge tone="dark">{t("library.card.combining")}</Badge>}
          {video.status === "failed" && <Badge tone="red">{t("library.card.importFailed")}</Badge>}
          {video.status === "recording" && (
            <Badge tone="red">
              <span className="size-1.5 animate-pulse rounded-full bg-white" /> {t("library.card.recording")}
            </Badge>
          )}
          {video.deletedAt && <Badge tone="dark">{t("library.card.removed")}</Badge>}
          {video.visibility === "workspace" && <Badge tone="dark">{t("library.card.membersOnly")}</Badge>}
        </span>
      </a>
      <div className="library-card-body flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <a href={`/${video.id}`} title={title} className="line-clamp-2 text-sm leading-snug font-semibold text-neutral-900 hover:text-red-700">
            {title}
          </a>
          <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-neutral-500">
            {showOwner && video.ownerName ? `${video.ownerName} · ` : ""}
            {localizedTimeAgo(video.createdAt, language, t, dateReference)} <span aria-hidden="true">·</span> <EyeIcon size={12} /> {localizedViews(video.views, language, t)}
          </p>
          {video.snippet && <p className="mt-1.5 line-clamp-2 text-xs text-neutral-600">{video.snippet}</p>}
        </div>
        <div ref={menuRef} className="relative flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t("library.card.copyLinkTo", { title })}
            onClick={async () => {
              setCopied(false)
              setCopyError(false)
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/${video.id}`)
                void fetch(`/api/recordings/${video.id}/shared`, { method: "POST" }).catch(() => {})
                markGuide("copied")
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              } catch { setCopyError(true) }
            }}
            title={copyError ? t("library.card.copyFailedTitle") : t("library.card.copyShare")}
            className={`library-copy-button ${copied ? "is-copied" : ""}`}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}<span>{copied ? t("common.copied") : copyError ? t("common.tryAgain") : t("library.actions.copyLink")}</span>
          </button>
          <span className="sr-only" role="status">{copied ? t("library.card.linkCopied") : copyError ? t("library.card.copyFailed") : ""}</span>
          {mine && (
            <button
              type="button"
              aria-label={t("library.card.more")}
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
                  {video.deletedAt ? t("library.card.restore") : t("library.card.keep")}
                </button>
              )}
              {!video.deletedAt && (
                <>
                  {ready && <a href={`/${video.id}?panel=customize`} className={item}>{t("library.card.customize")}</a>}
                  {ready && (
                    <button type="button" className={item} disabled={download === "rendering"} onClick={() => void downloadVideo()}>
                      {download === "rendering" ? t("library.card.rendering") : download === "failed" ? t("library.card.renderFailed") : t("library.card.download")}
                    </button>
                  )}
                  <button type="button" className={item} onClick={() => (setMenu(false), onMove())}>
                    {t("library.card.move")}
                  </button>
                  <button type="button" className={item} onClick={() => (setMenu(false), onPatch({ archived: !video.archivedAt }, true))}>
                    {video.archivedAt ? t("library.card.unarchive") : t("library.nav.archive")}
                  </button>
                  <button
                    type="button"
                    className={item}
                    onClick={() => (setMenu(false), onPatch({ visibility: video.visibility === "workspace" ? "link" : "workspace" }, false))}
                  >
                    {video.visibility === "workspace" ? t("library.access.link") : t("library.card.membersOnly")}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={async () => {
                  setMenu(false)
                  if (!(await askConfirm({ title: t("library.card.deleteTitle", { title }), body: t("library.card.deleteBody"), confirmLabel: t("library.card.deleteConfirm"), danger: true }))) return
                  void fetch(`/api/recordings/${video.id}`, { method: "DELETE" }).then((response) => {
                    if (response.ok) onDeleted()
                  })
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                {t("common.delete")}
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
      link.href = `/api/media/${video.id}?original=1`
      const name = (video.title || video.id).replace(/[^\w\- ]+/g, "").trim() || video.id
      link.download = `${name}.mp4`
      link.click()
    }, index * 800)
  })
}
