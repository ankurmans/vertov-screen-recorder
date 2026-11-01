import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { PuzzlePieceIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { getWorkspaceContext } from "@/lib/workspace.server"

// Chrome extension ids are 32 letters a-p.
const EXTENSION_ID = /^[a-p]{32}$/

const loadConnect = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  const user = await getSessionUser(request)
  if (!user) return null
  const { workspace, memberships } = await getWorkspaceContext(request, user)
  return { name: user.name, workspace: workspace.name, workspaceId: workspace.id, memberships }
})

/**
 * The extension opens this page to sign in: on Allow it gets an API key for the active workspace,
 * handed to the extension's own connect page in the URL fragment (never sent to a server).
 */
export const Route = createFileRoute("/connect-extension")({
  validateSearch: (search: Record<string, unknown>) => ({
    ext: typeof search.ext === "string" && EXTENSION_ID.test(search.ext) ? search.ext : undefined,
  }),
  loaderDeps: ({ search }) => ({ ext: search.ext }),
  loader: async ({ deps }) => {
    const data = await loadConnect()
    if (!data) throw redirect({ to: "/signin", search: { redirect: `/connect-extension${deps.ext ? `?ext=${deps.ext}` : ""}` } })
    return data
  },
  head: () => ({ meta: [{ title: `Connect the extension — ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: ConnectPage,
})

function ConnectPage() {
  const data = Route.useLoaderData()
  const { ext } = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(id: string) {
    await fetch("/api/workspace/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
    window.location.reload()
  }

  async function allow() {
    if (!ext) return
    setBusy(true)
    const response = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Chrome extension" }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { token?: string } | null
    if (!response?.ok || !body?.token) {
      setError("Couldn't create a key. Try again.")
      setBusy(false)
      return
    }
    const fragment = new URLSearchParams({ server: window.location.origin, token: body.token, workspace: data.workspace })
    window.location.href = `chrome-extension://${ext}/connect.html#${fragment.toString()}`
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <PuzzlePieceIcon size={22} />
        </div>
        {ext ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">Connect the {APP_NAME} extension</h1>
            <p className="mt-1 text-sm text-neutral-600">
              It will record and upload as {data.name} into <strong>{data.workspace}</strong>. You can disconnect it any time from Settings → Agents.
            </p>
            {data.memberships.length > 1 && (
              <label className="mt-4 block text-sm">
                <span className="text-neutral-700">Workspace</span>
                <select
                  value={data.workspaceId}
                  onChange={(event) => void pick(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                >
                  {data.memberships.map((membership) => (
                    <option key={membership.id} value={membership.id}>
                      {membership.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void allow()}
              className="mt-5 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Allow"}
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">Open this from the extension</h1>
            <p className="mt-1 text-sm text-neutral-600">Click the {APP_NAME} icon in Chrome's toolbar and choose Connect.</p>
          </>
        )}
      </div>
    </main>
  )
}
