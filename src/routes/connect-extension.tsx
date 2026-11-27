import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useEffect, useState } from "react"
import { BrandMark } from "@/components/brand-mark"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { reportChromeEvent } from "@/lib/chrome-analytics"
import { connectFragment, extensionAllowed, isLocalHost, parseConnectState, parseExtensionId } from "@/lib/extension-connect"
import { getWorkspaceContext } from "@/lib/workspace.server"
import { translatorFromMatches, useT } from "@/lib/i18n/react"

const loadConnect = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  const user = await getSessionUser(request)
  if (!user) return null
  const { workspace, memberships } = await getWorkspaceContext(request, user)
  return { name: user.name, workspace: workspace.name, workspaceId: workspace.id, memberships, local: isLocalHost(new URL(request.url).hostname) }
})

/**
 * The extension opens this page to sign in: on Allow it gets an API key for the active workspace,
 * handed to the extension's own connect page in the URL fragment (never sent to a server).
 * The popup's one-time `state` rides along and comes back in that fragment; the extension only stores
 * the key when it matches the connect request it started. On the hosted site only the published extension id is trusted.
 */
export const Route = createFileRoute("/connect-extension")({
  validateSearch: (search: Record<string, unknown>) => ({
    ext: parseExtensionId(search.ext),
    state: parseConnectState(search.state),
  }),
  loaderDeps: ({ search }) => ({ ext: search.ext, state: search.state }),
  loader: async ({ deps }) => {
    const data = await loadConnect()
    if (!data) {
      const query = new URLSearchParams()
      if (deps.ext) query.set("ext", deps.ext)
      if (deps.state) query.set("state", deps.state)
      const text = query.toString()
      throw redirect({ to: "/signin", search: { redirect: `/connect-extension${text ? `?${text}` : ""}` } })
    }
    return data
  },
  head: ({ matches }) => ({ meta: [{ title: translatorFromMatches(matches)("auth.connect.metaTitle", { app: APP_NAME }) }, { name: "robots", content: "noindex" }] }),
  component: ConnectPage,
})

function ConnectPage() {
  const t = useT()
  const data = Route.useLoaderData()
  const { ext, state } = Route.useSearch()
  const trusted = extensionAllowed(ext, { local: data.local })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ext && state && trusted) reportChromeEvent("extension_onboarding_started")
  }, [ext, state, trusted])

  async function pick(id: string) {
    await fetch("/api/workspace/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
    window.location.reload()
  }

  async function allow() {
    if (!ext || !state || !trusted) return
    setBusy(true)
    const response = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Chrome extension" }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { token?: string } | null
    if (!response?.ok || !body?.token) {
      setError(t("auth.connect.keyFailed"))
      setBusy(false)
      return
    }
    reportChromeEvent("extension_authenticated")
    const fragment = connectFragment({ server: window.location.origin, token: body.token, workspace: data.workspace, state })
    window.location.href = `chrome-extension://${ext}/connect.html#${fragment}`
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <BrandMark size={44} />
        </div>
        {ext && state && trusted ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("auth.connect.title", { app: APP_NAME })}</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {t.rich("auth.connect.body", { name: data.name, workspace: data.workspace }, { strong: (c) => <strong>{c}</strong> })}
            </p>
            {data.memberships.length > 1 && (
              <label className="mt-4 block text-sm">
                <span className="text-neutral-700">{t("auth.connect.workspace")}</span>
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
              {busy ? t("auth.connect.connecting") : t("auth.connect.allow")}
            </button>
          </>
        ) : ext && state ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("auth.connect.notExtensionTitle", { app: APP_NAME })}</h1>
            <p className="mt-1 text-sm text-neutral-600">{t("auth.connect.notExtensionBody", { app: APP_NAME })}</p>
          </>
        ) : ext ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("auth.connect.updateTitle")}</h1>
            <p className="mt-1 text-sm text-neutral-600">{t("auth.connect.updateBody", { app: APP_NAME })}</p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("auth.connect.openTitle")}</h1>
            <p className="mt-1 text-sm text-neutral-600">{t("auth.connect.openBody", { app: APP_NAME })}</p>
          </>
        )}
      </div>
    </main>
  )
}
