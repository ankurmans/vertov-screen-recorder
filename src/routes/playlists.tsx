import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, LinkSimpleIcon, TrashIcon, XIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"
import { BrandMark } from "@/components/brand-mark"
import { CommandPaletteButton } from "@/components/command-palette"
import { VertovIcon } from "@/components/vertov-icon"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { formatDuration } from "@/lib/format"
import { getWorkspaceContext } from "@/lib/workspace.server"

const loadWorkspace = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  const user = await getSessionUser(request)
  if (!user) return null
  const { workspace } = await getWorkspaceContext(request, user)
  return { name: workspace.name }
})

interface Summary {
  id: string
  title: string
  description: string | null
  visibility: "link" | "workspace"
  count: number
}

interface Detail {
  playlist: { id: string; title: string; description: string | null; visibility: "link" | "workspace" }
  canEdit: boolean
  videos: Array<{ id: string; title: string; duration: number | null; hasPoster: boolean; playable: boolean }>
}

export const Route = createFileRoute("/playlists")({
  validateSearch: (search: Record<string, unknown>): { id?: string } => (typeof search.id === "string" ? { id: search.id } : {}),
  loader: async () => {
    const data = await loadWorkspace()
    if (!data) throw redirect({ to: "/signin", search: { redirect: "/playlists" } })
    return data
  },
  head: () => ({ meta: [{ title: `Playlists · ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: PlaylistsPage,
})

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }).catch(() => null)
  if (response?.ok) return { ok: true }
  const parsed = (await response?.json().catch(() => null)) as { error?: string } | null
  return { ok: false, error: parsed?.error ?? "Something went wrong. Try again." }
}

function PlaylistsPage() {
  const { name } = Route.useLoaderData()
  const { id } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [playlists, setPlaylists] = useState<Array<Summary> | null>(null)
  const [title, setTitle] = useState("")
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    const response = await fetch("/api/playlists").catch(() => null)
    const body = (await response?.json().catch(() => null)) as { playlists?: Array<Summary> } | null
    setPlaylists(body?.playlists ?? [])
  }, [])
  useEffect(() => void refresh(), [refresh])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const response = await fetch("/api/playlists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { playlist?: Summary; error?: string } | null
    if (!body?.playlist) return setError(body?.error ?? "Couldn't create the playlist")
    setTitle("")
    setError("")
    await refresh()
    void navigate({ search: { id: body.playlist.id } })
  }

  return (
    <main className="library-shell min-h-dvh text-neutral-900">
      <header className="border-b border-neutral-200 bg-white/85">
        <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-3 px-4 lg:px-8">
          <a href="/app" className="flex items-center gap-2 rounded-lg p-1 text-sm hover:text-red-700">
            <BrandMark size={28} />
            <ArrowLeftIcon size={16} /> Library
          </a>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">{name}</span>
          <CommandPaletteButton />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1480px] gap-8 px-4 py-8 lg:grid-cols-[300px_minmax(0,1fr)] lg:px-8">
        <section aria-labelledby="playlists-title" className="min-w-0">
          <h1 id="playlists-title" className="text-2xl font-semibold tracking-tight">Playlists</h1>
          <p className="mt-1 text-sm text-neutral-500">Group videos into a series and share one link.</p>
          <form onSubmit={(event) => void create(event)} className="mt-5 flex gap-2">
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="New playlist name" aria-label="New playlist name" className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
            <button type="submit" disabled={!title.trim()} className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Create
            </button>
          </form>
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
          <ul className="mt-5 space-y-1">
            {playlists === null && <li className="h-10 animate-pulse rounded-lg bg-neutral-200/70" />}
            {playlists?.length === 0 && <li className="text-sm text-neutral-500">No playlists yet. Name one above, then add videos from a video's menu in your library.</li>}
            {playlists?.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  onClick={() => void navigate({ search: { id: playlist.id } })}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${playlist.id === id ? "bg-white font-medium shadow-sm ring-1 ring-neutral-200" : "text-neutral-700 hover:bg-neutral-200/60"}`}
                >
                  <VertovIcon name="playlist" size={16} />
                  <span className="min-w-0 flex-1 truncate">{playlist.title}</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">{playlist.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-w-0">{id ? <PlaylistEditor key={id} id={id} onChanged={refresh} onDeleted={() => (void refresh(), void navigate({ search: {} }))} /> : <p className="mt-16 text-center text-sm text-neutral-500">Choose a playlist to see its videos.</p>}</section>
      </div>
    </main>
  )
}

function PlaylistEditor({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [missing, setMissing] = useState(false)
  const [message, setMessage] = useState("")
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/playlists/${id}`).catch(() => null)
    if (!response?.ok) return setMissing(true)
    setDetail((await response.json()) as Detail)
  }, [id])
  useEffect(() => void load(), [load])

  if (missing) return <p className="text-sm text-neutral-500">This playlist doesn't exist in this workspace.</p>
  if (!detail) return <div className="h-40 animate-pulse rounded-2xl bg-neutral-200/70" />

  const { playlist, canEdit, videos } = detail
  const act = async (request: Promise<{ ok: boolean; error?: string }>) => {
    const result = await request
    if (!result.ok) return setMessage(result.error ?? "Something went wrong")
    setMessage("")
    await load()
    onChanged()
  }
  const move = (from: number, to: number) => {
    const order = videos.map((video) => video.id)
    const [item] = order.splice(from, 1)
    order.splice(to, 0, item)
    void act(send(`/api/playlists/${id}`, "PATCH", { order }))
  }
  const link = `${window.location.origin}/p/${playlist.id}`

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight text-balance">{playlist.title}</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {videos.length} {videos.length === 1 ? "video" : "videos"} · {playlist.visibility === "workspace" ? "Members only" : "Anyone with the link"}
          </p>
        </div>
        <a href={`/p/${playlist.id}`} target="_blank" rel="noreferrer" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
          Open
        </a>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(link).then(() => setMessage("Link copied"), () => setMessage(link))}
          className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white"
        >
          <LinkSimpleIcon size={14} /> Copy link
        </button>
      </div>
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => void act(send(`/api/playlists/${id}`, "PATCH", { visibility: playlist.visibility === "workspace" ? "link" : "workspace" }))}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 hover:bg-neutral-50"
          >
            {playlist.visibility === "workspace" ? "Make it shareable by link" : "Make it members only"}
          </button>
          {confirming ? (
            <>
              <span className="text-neutral-600">Delete this playlist? The videos stay in your library.</span>
              <button type="button" onClick={() => void send(`/api/playlists/${id}`, "DELETE").then((result) => (result.ok ? onDeleted() : setMessage(result.error ?? "")))} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white">
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-neutral-700 hover:bg-neutral-100">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-50">
              <TrashIcon size={14} /> Delete playlist
            </button>
          )}
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm text-neutral-600">{message}</p>}
      <ol className="mt-5 divide-y divide-neutral-100">
        {videos.length === 0 && <li className="py-6 text-sm text-neutral-500">No videos yet. In your library, open a video's ⋯ menu and choose Add to playlist.</li>}
        {videos.map((video, index) => (
          <li key={video.id} className="flex items-center gap-3 py-2.5">
            <span className="w-5 text-right font-mono text-xs text-neutral-400 tabular-nums">{index + 1}</span>
            <span className="aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-neutral-200">{video.hasPoster && <img src={`/api/poster/${video.id}`} alt="" loading="lazy" className="size-full object-cover" />}</span>
            <a href={`/${video.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
              {video.title}
            </a>
            {!video.playable && <span className="text-xs text-neutral-500">Gated</span>}
            {video.duration ? <span className="font-mono text-xs text-neutral-500 tabular-nums">{formatDuration(video.duration)}</span> : null}
            {canEdit && (
              <span className="flex items-center">
                <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ArrowUpIcon size={14} />
                </button>
                <button type="button" aria-label="Move down" disabled={index === videos.length - 1} onClick={() => move(index, index + 1)} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ArrowDownIcon size={14} />
                </button>
                <button type="button" aria-label="Remove from playlist" onClick={() => void act(send(`/api/playlists/${id}/items?uploadId=${video.id}`, "DELETE"))} className="rounded p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600">
                  <XIcon size={14} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
