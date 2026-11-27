import { createFileRoute } from "@tanstack/react-router"
import { PoweredBy } from "@/components/powered-by"
import { createServerFn } from "@tanstack/react-start"
import { VideoCameraIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { getRequest } from "@tanstack/react-start/server"
import { RequestInvite } from "@/components/request-invite"
import { parseDone } from "@/lib/request-link"
import { loadRequestInvite } from "@/lib/request-invite.server"
import { startAsGuest } from "@/lib/auth-client"
import { APP_NAME } from "@/lib/brand"
import { liveRequest, requestIsFull } from "@/lib/requests.server"
import { translatorFromMatches, useT } from "@/lib/i18n/react"

const loadRequest = createServerFn({ method: "GET" })
  .validator((data: { id: string; done: boolean }) => data)
  .handler(async ({ data }) => {
    const live = await liveRequest(data.id, getRequest())
    // A full link still thanks the person whose video filled it.
    if (!live || (!data.done && (await requestIsFull(live.request)))) return null
    const invite = data.done ? await loadRequestInvite(getRequest(), live.request.workspaceId).catch(() => null) : null
    return { title: live.request.title, message: live.request.message, from: live.workspaceName, invite }
  })

export const Route = createFileRoute("/request/$id")({
  validateSearch: (search: Record<string, unknown>) => ({ done: parseDone(search.done) }),
  loaderDeps: ({ search }) => ({ done: Boolean(search.done) }),
  loader: ({ params, deps }) => loadRequest({ data: { id: params.id, done: deps.done } }),
  head: ({ matches }) => ({ meta: [{ title: translatorFromMatches(matches)("auth.request.metaTitle", { app: APP_NAME }) }, { name: "robots", content: "noindex" }] }),
  component: RequestPage,
})

export const REQUEST_NAME_KEY = "vertov_request_name"

function RequestPage() {
  const t = useT()
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
      return setError(t("auth.request.startFailed"))
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
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">{t("auth.request.closedTitle")}</h1>
            <p className="mt-2 text-sm text-neutral-500">{t("auth.request.closedBody")}</p>
          </>
        ) : done ? (
          <>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">{t("auth.request.doneTitle")}</h1>
            <p className="mt-2 text-sm text-neutral-500">{t("auth.request.doneBody", { from: request.from })}</p>
            {request.invite && <RequestInvite invite={request.invite} from={request.from} />}
            <a href={`/request/${id}`} className="mt-5 inline-block text-sm font-medium text-red-600 hover:underline">
              {t("auth.request.recordAnother")}
            </a>
          </>
        ) : (
          <>
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-red-600/10 text-red-600">
              <VideoCameraIcon size={22} weight="fill" />
            </span>
            <p className="mt-4 text-sm text-neutral-500">{t("auth.request.askedYou", { from: request.from })}</p>
            <h1 className="mt-1 text-2xl font-semibold text-balance text-neutral-900 dark:text-white">{request.title}</h1>
            {request.message && <p className="mt-3 text-sm whitespace-pre-line text-neutral-600 dark:text-neutral-300">{request.message}</p>}
            <label className="mt-6 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t("auth.request.nameLabel")}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder={t("auth.request.namePlaceholder")}
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-500 disabled:opacity-60"
            >
              <span className="size-2.5 rounded-full bg-white" /> {t("auth.request.record")}
            </button>
            <p className="mt-3 text-xs text-neutral-500">{t("auth.request.note")}</p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </>
        )}
        <PoweredBy className="mt-6" />
      </div>
    </main>
  )
}
