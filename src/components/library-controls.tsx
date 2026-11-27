import { useEffect, useState } from "react"
import { ArrowUpRightIcon, ListIcon, SquaresFourIcon, UploadSimpleIcon, VideoCameraIcon } from "@phosphor-icons/react"
import type { LibraryVideo } from "@/lib/library.server"
import { Eye } from "@/components/eye"
import type { MessageKey } from "@/lib/i18n/en/index"
import { useT, type AppTranslator } from "@/lib/i18n/react"

export type LibraryLayout = "grid" | "list"
export type LibrarySort = "newest" | "oldest" | "views" | "title"
const SORTS: Array<[LibrarySort, MessageKey]> = [
  ["newest", "library.sort.newest"],
  ["oldest", "library.sort.oldest"],
  ["views", "library.sort.views"],
  ["title", "library.sort.title"],
]

export interface LibraryFilters {
  access: string
  activity: "all" | "viewed" | "unviewed"
  date: "any" | "7" | "30" | "365"
}
export const NO_FILTERS: LibraryFilters = { access: "all", activity: "all", date: "any" }
const accessLabel = (value: string, t: AppTranslator) => (value === "link" ? t("library.access.link") : value === "workspace" ? t("library.access.workspace") : value)

export function filterLibraryVideos(videos: Array<LibraryVideo>, filters: LibraryFilters) {
  const since = filters.date === "any" ? 0 : Date.now() - Number(filters.date) * 86_400_000
  return videos.filter(
    (video) =>
      (filters.access === "all" || video.visibility === filters.access) &&
      (filters.activity === "all" || (filters.activity === "viewed" ? video.views > 0 : video.views === 0)) &&
      (since === 0 || new Date(video.createdAt).getTime() >= since),
  )
}

export function useLibraryPresentation() {
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS)
  const [layout, setLayout] = useState<LibraryLayout>("grid")
  const [sort, setSort] = useState<LibrarySort>("newest")
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("vertov.library.presentation") || "null") as {
        layout?: string
        sort?: string
      } | null
      if (saved?.layout === "grid" || saved?.layout === "list") setLayout(saved.layout)
      if (SORTS.some(([value]) => value === saved?.sort)) setSort(saved!.sort as LibrarySort)
    } catch {
      /* Storage is optional; the controls still work. */
    }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem("vertov.library.presentation", JSON.stringify({ layout, sort }))
    } catch {
      /* Keep the in-memory preference. */
    }
  }, [layout, sort, loaded])
  return { layout, setLayout, sort, setSort, filters, setFilters, ready: loaded }
}

export function sortLibraryVideos(videos: Array<LibraryVideo>, sort: LibrarySort) {
  return [...videos].sort((a, b) => {
    if (sort === "title")
      return (
        (a.title || "Untitled video").localeCompare(b.title || "Untitled video", undefined, {
          numeric: true,
          sensitivity: "base",
        }) || b.createdAt.localeCompare(a.createdAt)
      )
    if (sort === "views") return b.views - a.views || b.createdAt.localeCompare(a.createdAt)
    const chronological = a.createdAt.localeCompare(b.createdAt)
    return sort === "oldest" ? chronological : -chronological
  })
}

const pill = "library-filter rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"

export function LibraryControls({ layout, setLayout, sort, setSort, filters, setFilters, ready, videos }: ReturnType<typeof useLibraryPresentation> & { videos: Array<LibraryVideo> }) {
  const t = useT()
  const accessValues = [...new Set(videos.map((video) => video.visibility))]
  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => setFilters({ ...filters, [key]: value })
  const active = filters.access !== "all" || filters.activity !== "all" || filters.date !== "any"
  return (
    <div className="library-controls">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t("library.filter.access")} disabled={!ready} value={filters.access} onChange={(event) => set("access", event.target.value)} className={pill}>
          <option value="all">{t("library.filter.access")}</option>
          {accessValues.map((value) => (
            <option key={value} value={value}>{accessLabel(value, t)}</option>
          ))}
        </select>
        <select aria-label={t("library.filter.activity")} disabled={!ready} value={filters.activity} onChange={(event) => set("activity", event.target.value as LibraryFilters["activity"])} className={pill}>
          <option value="all">{t("library.filter.activity")}</option>
          <option value="viewed">{t("library.filter.hasViews")}</option>
          <option value="unviewed">{t("library.filter.noViews")}</option>
        </select>
        <select aria-label={t("library.filter.uploadDate")} disabled={!ready} value={filters.date} onChange={(event) => set("date", event.target.value as LibraryFilters["date"])} className={pill}>
          <option value="any">{t("library.filter.uploadDate")}</option>
          <option value="7">{t("library.filter.past7")}</option>
          <option value="30">{t("library.filter.past30")}</option>
          <option value="365">{t("library.filter.pastYear")}</option>
        </select>
        {active && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="rounded-lg px-2 py-1.5 text-sm text-neutral-500 hover:text-neutral-900">
            {t("library.filter.clear")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <select aria-label={t("library.sort.label")} disabled={!ready} value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)} className={pill}>
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>{t(label)}</option>
          ))}
        </select>
        <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5" role="group" aria-label={t("library.layout.label")}>
          {(
            [
              ["grid", SquaresFourIcon, "library.layout.grid"],
              ["list", ListIcon, "library.layout.list"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              aria-label={t(label)}
              aria-pressed={layout === value}
              disabled={!ready}
              onClick={() => setLayout(value)}
              className={`rounded-md p-2 ${layout === value ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FirstVideo({
  spaceId,
  onUpload,
  onRequest,
  onBrowse,
}: {
  spaceId: string | null
  onUpload: () => void
  onRequest: () => void
  onBrowse: () => void
}) {
  const t = useT()
  return (
    <div className="library-welcome">
      <div className="library-welcome-intro">
        <span className="library-welcome-eye">
          <Eye size={76} tone="paper" />
        </span>
        <p className="mb-2 text-xs font-medium tracking-widest text-red-700 uppercase">{t("library.welcome.eyebrow")}</p>
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900">
          {spaceId ? t("library.welcome.spaceTitle") : t("library.welcome.title")}
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-600">
          {spaceId ? t("library.welcome.spaceBody") : t("library.welcome.body")}
        </p>
      </div>
      <div className="library-welcome-actions">
        <a
          href={spaceId ? `/record?space=${encodeURIComponent(spaceId)}` : "/record"}
          className="library-start-action library-start-action-primary"
        >
          <VideoCameraIcon size={22} />
          <span>
            <strong>{t("library.actions.recordVideo")}</strong>
            <small>{t("library.actions.recordHint")}</small>
          </span>
          <ArrowUpRightIcon size={17} />
        </a>
        <button type="button" onClick={spaceId ? onBrowse : onUpload} className="library-start-action">
          <UploadSimpleIcon size={22} />
          <span>
            <strong>{spaceId ? t("library.welcome.chooseTitle") : t("library.welcome.bringTitle")}</strong>
            <small>{spaceId ? t("library.welcome.chooseHint") : t("library.welcome.bringHint")}</small>
          </span>
          <ArrowUpRightIcon size={17} />
        </button>
        {!spaceId && (
          <button type="button" onClick={onRequest} className="library-start-action">
            <VideoCameraIcon size={22} />
            <span>
              <strong>{t("library.welcome.requestTitle")}</strong>
              <small>{t("library.welcome.requestHint")}</small>
            </span>
            <ArrowUpRightIcon size={17} />
          </button>
        )}
      </div>
    </div>
  )
}

export function LibraryNextStep({ onUpload, onRequest }: { onUpload: () => void; onRequest: () => void }) {
  const t = useT()
  return (
    <aside className="library-next-step">
      <span className="library-next-eye">
        <Eye size={40} tone="paper" />
      </span>
      <span className="flex-1">
        <strong className="block text-sm font-semibold text-neutral-800">{t("library.nextStep.title")}</strong>
        <span className="mt-1 block text-xs text-neutral-500">
          {t("library.nextStep.body")}
        </span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/record"
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
        >
          <VideoCameraIcon size={15} /> {t("library.actions.record")}
        </a>
        <button
          type="button"
          onClick={onUpload}
          className="rounded-lg px-3 py-2 text-xs text-neutral-600 hover:bg-white"
        >
          {t("library.actions.upload")}
        </button>
        <button
          type="button"
          onClick={onRequest}
          className="rounded-lg px-3 py-2 text-xs text-neutral-600 hover:bg-white"
        >
          {t("library.actions.requestVideo")}
        </button>
      </div>
    </aside>
  )
}
