import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { UsersThreeIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { inviteInfo } from "@/lib/workspace.server"

const loadInvite = createServerFn({ method: "GET" })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const user = await getSessionUser(getRequest())
    if (!user) return { signedIn: false } as const
    const invite = await inviteInfo(token, user.sub)
    return invite ? ({ signedIn: true, valid: true, ...invite } as const) : ({ signedIn: true, valid: false } as const)
  })

export const Route = createFileRoute("/join/$token")({
  loader: async ({ params }) => {
    const invite = await loadInvite({ data: params.token })
    if (!invite.signedIn) throw redirect({ to: "/signin", search: { redirect: `/join/${params.token}` } })
    return invite
  },
  head: () => ({ meta: [{ title: `Join a workspace — ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: JoinPage,
})

function JoinPage() {
  const invite = Route.useLoaderData()
  const { token } = Route.useParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function join() {
    setBusy(true)
    const response = await fetch(`/api/join/${token}`, { method: "POST" }).catch(() => null)
    if (response?.ok) {
      window.location.href = "/"
      return
    }
    const body = (await response?.json().catch(() => null)) as { error?: string } | null
    setError(body?.error ?? "Couldn't join. Try again.")
    setBusy(false)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <UsersThreeIcon size={22} />
        </div>
        {invite.valid ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">Join {invite.name}</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {invite.already
                ? "You're already in this workspace."
                : `You'll join as ${invite.role === "admin" ? "an admin" : "a member"}: record into the shared library and see its spaces. It's free.`}
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void join()}
              className="mt-5 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {invite.already ? "Open workspace" : busy ? "Joining…" : "Join workspace"}
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">This invite link has expired</h1>
            <p className="mt-1 text-sm text-neutral-600">Ask the person who sent it for a new one.</p>
            <a href="/" className="mt-5 block text-sm font-medium text-neutral-900 underline">
              Go to your library
            </a>
          </>
        )}
      </div>
    </main>
  )
}
