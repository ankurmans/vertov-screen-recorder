import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { VideoCameraIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { startAsGuest } from "@/lib/auth-client"
import { APP_NAME } from "@/lib/brand"
import { liveRequest } from "@/lib/requests.server"

const loadRequest = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const live = await liveRequest(id)
    if (!live) return null
    return { title: live.request.title, message: live.request.message, from: live.workspaceName }
  })

export const Route = createFileRoute("/request/$id")({
  validateSearch: (search: Record<string, unknown>) => ({ done: search.done === "1" || search.done === 1 ? true : undefined }),
  loader: ({ params }) => loadRequest({ data: params.id }),
  head: () => ({ meta: [{ title: `Record a video — ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: RequestPage,
})

export const REQUEST_NAME_KEY = "vertov_request_name"

function RequestPage() {
  const request = Route.useLoaderData()
  const { id } = Route.useParams()
  const { done } = Route.useSearch()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    if (!(await startAsGuest())) {
      setBusy(false)
      return setError("Couldn't get started. Reload and try again.")
    }
    try {
      sessionStorage.setItem(REQUEST_NAME_KEY, name.trim())
    } catch {
      // The name is optional.
    }
    window.location.href = `/record?request=${id}`
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {!request ? (
          <>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">This link has closed</h1>
            <p className="mt-2 text-sm text-neutral-500">Ask the person who sent it for a new one.</p>
          </>
        ) : done ? (
          <>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Sent. Thank you.</h1>
            <p className="mt-2 text-sm text-neutral-500">{request.from} has your video. You can close this tab.</p>
            <a href={`/request/${id}`} className="mt-5 inline-block text-sm font-medium text-red-600 hover:underline">
              Record another
            </a>
          </>
        ) : (
          <>
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-red-600/10 text-red-600">
              <VideoCameraIcon size={22} weight="fill" />
            </span>
            <p className="mt-4 text-sm text-neutral-500">{request.from} asked you to record</p>
            <h1 className="mt-1 text-2xl font-semibold text-balance text-neutral-900 dark:text-white">{request.title}</h1>
            {request.message && <p className="mt-3 text-sm whitespace-pre-line text-neutral-600 dark:text-neutral-300">{request.message}</p>}
            <label className="mt-6 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Your name (optional)
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="So they know who it's from"
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-500 disabled:opacity-60"
            >
              <span className="size-2.5 rounded-full bg-white" /> Record my video
            </button>
            <p className="mt-3 text-xs text-neutral-500">No account needed. Your browser asks to use your camera, microphone or screen. Nothing is recorded until you press start.</p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </main>
  )
}
