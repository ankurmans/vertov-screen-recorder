import { useEffect, useState } from "react"
import { ListIcon, SquaresFourIcon, UploadSimpleIcon, VideoCameraIcon, ArrowUpRightIcon } from "@phosphor-icons/react"
import type { LibraryVideo } from "@/lib/library.server"
import { HOSTED_EDITION } from "@/lib/edition"
import { Eye } from "@/components/eye"

export type LibraryLayout = "grid" | "list"
export type LibrarySort = "newest" | "oldest" | "views" | "title"
const SORTS: Array<[LibrarySort, string]> = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["views", "Most viewed"],
  ["title", "Title A–Z"],
]

export function useLibraryPresentation() {
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
  return { layout, setLayout, sort, setSort, ready: loaded }
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

export function LibraryControls({ layout, setLayout, sort, setSort, ready }: ReturnType<typeof useLibraryPresentation>) {
  return (
    <div className="library-controls">
      <label className="flex items-center gap-2 text-xs text-neutral-500">
        Sort{" "}
        <select
          aria-label="Sort recordings"
          disabled={!ready}
          value={sort}
          onChange={(event) => setSort(event.target.value as LibrarySort)}
          className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm text-neutral-700"
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div
        className="flex rounded-lg border border-neutral-200 bg-white p-0.5"
        role="group"
        aria-label="Library layout"
      >
        {(
          [
            ["grid", SquaresFourIcon, "Grid view"],
            ["list", ListIcon, "List view"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
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
  return (
    <div className="library-welcome">
      <div className="library-welcome-intro">
        <span className="library-welcome-eye">
          <Eye size={76} tone="paper" />
        </span>
        <p className="mb-2 text-xs font-medium tracking-widest text-red-700 uppercase">Ready when you are</p>
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900">
          {spaceId ? "Give this space its first video." : "Your first video starts here."}
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-600">
          {spaceId
            ? "Record straight into this space, or move a video here from your library."
            : "Walk someone through an idea, share an update, or show what needs fixing."}
        </p>
      </div>
      <div className="library-welcome-actions">
        <a
          href={spaceId ? `/record?space=${encodeURIComponent(spaceId)}` : "/record"}
          className="library-start-action library-start-action-primary"
        >
          <VideoCameraIcon size={22} />
          <span>
            <strong>Record a video</strong>
            <small>Screen, camera or both</small>
          </span>
          <ArrowUpRightIcon size={17} />
        </a>
        <button type="button" onClick={spaceId ? onBrowse : onUpload} className="library-start-action">
          <UploadSimpleIcon size={22} />
          <span>
            <strong>{spaceId ? "Choose from your library" : "Bring a video over"}</strong>
            <small>{spaceId ? "Use a video’s Move menu to add it here" : HOSTED_EDITION ? "Upload a file or import from Loom" : "Upload a video file"}</small>
          </span>
          <ArrowUpRightIcon size={17} />
        </button>
        {!spaceId && (
          <button type="button" onClick={onRequest} className="library-start-action">
            <VideoCameraIcon size={22} />
            <span>
              <strong>Ask someone to record</strong>
              <small>Send a video request link</small>
            </span>
            <ArrowUpRightIcon size={17} />
          </button>
        )}
      </div>
    </div>
  )
}

export function LibraryNextStep({ onUpload, onRequest }: { onUpload: () => void; onRequest: () => void }) {
  return (
    <aside className="library-next-step">
      <span className="library-next-eye">
        <Eye size={40} tone="paper" />
      </span>
      <span className="flex-1">
        <strong className="block text-sm font-semibold text-neutral-800">Have something to show?</strong>
        <span className="mt-1 block text-xs text-neutral-500">
          A walkthrough, a quick update, or a question for someone else.
        </span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/record"
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
        >
          <VideoCameraIcon size={15} /> Record
        </a>
        <button
          type="button"
          onClick={onUpload}
          className="rounded-lg px-3 py-2 text-xs text-neutral-600 hover:bg-white"
        >
          Upload
        </button>
        <button
          type="button"
          onClick={onRequest}
          className="rounded-lg px-3 py-2 text-xs text-neutral-600 hover:bg-white"
        >
          Request a video
        </button>
      </div>
    </aside>
  )
}
