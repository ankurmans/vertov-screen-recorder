import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest, getRequestUrl } from "@tanstack/react-start/server"
import { LockSimpleIcon, PlayIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { BrandMark } from "@/components/brand-mark"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { formatDuration } from "@/lib/format"
import { viewPlaylist } from "@/lib/playlists.server"

const loadPlaylist = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const request = getRequest()
    const view = await viewPlaylist(id, request, await getSessionUser(request))
    return view ? { ...view, origin: getRequestUrl().origin } : null
  })

export const Route = createFileRoute("/p/$id")({
  loader: async ({ params }) => {
    const view = await loadPlaylist({ data: params.id })
    if (!view) throw notFound()
    return view
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.playlist.title} — ${APP_NAME}` },
          { name: "robots", content: "noindex" },
          { property: "og:title", content: loaderData.playlist.title },
          { property: "og:description", content: loaderData.playlist.description || `${loaderData.videos.length} videos on ${APP_NAME}` },
          ...(loaderData.videos[0]?.hasPoster ? [{ property: "og:image", content: `${loaderData.origin}/api/poster/${loaderData.videos[0].id}` }] : []),
        ]
      : [{ name: "robots", content: "noindex" }],
  }),
  component: PlaylistPage,
  notFoundComponent: () => (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Playlist not found</h1>
        <p className="mt-1 text-sm text-neutral-500">It may have been deleted, or it's only for workspace members.</p>
      </div>
    </main>
  ),
})

function PlaylistPage() {
  const { playlist, videos } = Route.useLoaderData()
  const first = Math.max(0, videos.findIndex((video) => video.playable))
  const [current, setCurrent] = useState(first)
  const playing = videos[current]
  const total = videos.reduce((sum, video) => sum + (video.duration ?? 0), 0)

  return (
    <main className="library-shell min-h-dvh text-neutral-900">
      <header className="border-b border-neutral-200 bg-white/85">
        <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-3 px-4 lg:px-8">
          <a href="/" aria-label={`${APP_NAME} home`}>
            <BrandMark size={28} />
          </a>
          <span className="text-sm text-neutral-500">Playlist</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1480px] gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <section className="min-w-0">
          {playing?.playable ? (
            <div className="aspect-video w-full overflow-hidden rounded-2xl bg-neutral-950 shadow-sm">
              <iframe key={playing.id} src={`/embed/${playing.id}`} title={playing.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen className="size-full border-0" />
            </div>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-neutral-200 text-sm text-neutral-600">
              {videos.length ? "Pick a video from the list" : "This playlist is empty"}
            </div>
          )}
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance">{playlist.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {videos.length} {videos.length === 1 ? "video" : "videos"}
            {total > 0 && ` · ${formatDuration(total)}`}
          </p>
          {playlist.description && <p className="mt-3 max-w-[65ch] text-sm leading-relaxed whitespace-pre-line text-neutral-700">{playlist.description}</p>}
          {playing && (
            <p className="mt-4 text-sm">
              Now playing: <a href={`/${playing.id}`} className="font-medium underline-offset-2 hover:underline">{playing.title}</a>
            </p>
          )}
        </section>
        <aside aria-label="Videos in this playlist" className="min-w-0">
          <ol className="flex flex-col gap-1.5">
            {videos.map((video, index) => {
              const active = index === current
              const body = (
                <>
                  <span className="w-5 shrink-0 text-right font-mono text-xs text-neutral-400 tabular-nums">{active ? <PlayIcon weight="fill" className="ml-auto text-red-600" /> : index + 1}</span>
                  <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-200">
                    {video.hasPoster && <img src={`/api/poster/${video.id}`} alt="" loading="lazy" className="size-full object-cover" />}
                    {video.duration ? <span className="absolute right-1 bottom-1 rounded bg-neutral-950/75 px-1 font-mono text-[10px] text-white">{formatDuration(video.duration)}</span> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium text-neutral-900">{video.title}</span>
                    {!video.playable && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                        <LockSimpleIcon size={12} /> Opens on its own page
                      </span>
                    )}
                  </span>
                </>
              )
              const className = `flex w-full items-center gap-3 rounded-xl p-2 text-left ${active ? "bg-white shadow-sm ring-1 ring-neutral-200" : "hover:bg-white/70"}`
              return (
                <li key={video.id}>
                  {video.playable ? (
                    <button type="button" aria-current={active || undefined} onClick={() => setCurrent(index)} className={className}>
                      {body}
                    </button>
                  ) : (
                    <a href={`/${video.id}`} className={className}>
                      {body}
                    </a>
                  )}
                </li>
              )
            })}
          </ol>
        </aside>
      </div>
    </main>
  )
}
