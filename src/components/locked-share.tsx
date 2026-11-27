import { EnvelopeSimpleIcon, HourglassIcon, LockSimpleIcon, TrashIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { APP_NAME } from "@/lib/brand"
import { HOSTED_EDITION } from "@/lib/edition"
import { useT } from "@/lib/i18n/react"

/** Shown instead of the video when the link is members-only, was removed or its guest recorder has not signed up. */
export function LockedShare({ id, reason }: { id: string; reason: "members" | "removed" | "email" | "unclaimed" }) {
  const t = useT()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function giveEmail(event: React.FormEvent) {
    event.preventDefault()
    if (!email || busy) return
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/email-gate/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    if (response?.ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setError(t("video.locked.invalidEmail"))
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-900 text-white">
          {reason === "email" ? (
            <EnvelopeSimpleIcon size={22} />
          ) : reason === "members" ? (
            <UsersThreeIcon size={22} />
          ) : reason === "removed" ? (
            <TrashIcon size={22} />
          ) : reason === "unclaimed" ? (
            <HourglassIcon size={22} />
          ) : (
            <LockSimpleIcon size={22} />
          )}
        </div>
        {reason === "email" ? (
          <form onSubmit={(event) => void giveEmail(event)}>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("video.locked.emailTitle")}</h1>
            <p className="mt-1 text-sm text-neutral-600">{t("video.locked.emailBody")}</p>
            <label htmlFor="viewer-email" className="mt-4 block text-sm font-medium text-neutral-700">
              {t("video.locked.emailLabel")}
            </label>
            <input
              id="viewer-email"
              type="email"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={!email || busy}
              className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? t("video.locked.oneMoment") : t("video.locked.watch")}
            </button>
          </form>
        ) : reason === "members" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("video.locked.membersTitle")}</h1>
            <p className="mt-1 text-sm text-neutral-600">{t("video.locked.membersBody")}</p>
            <a
              href={`/signin?redirect=${encodeURIComponent(`/${id}`)}`}
              className="mt-4 block w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-neutral-800"
            >
              {t("video.locked.signIn")}
            </a>
          </>
        ) : reason === "removed" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("video.locked.removedTitle")}</h1>
            <p className="mt-1 text-sm text-neutral-600">{t("video.locked.removedBody")}</p>
          </>
        ) : reason === "unclaimed" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900">{t("video.locked.unclaimedTitle")}</h1>
            <p className="mt-1 text-sm text-neutral-600">{t("video.locked.unclaimedBody")}</p>
            <a
              href={`/signin?redirect=${encodeURIComponent(`/${id}`)}`}
              className="mt-4 block w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-neutral-800"
            >
              {t("video.locked.unclaimedSignIn")}
            </a>
          </>
        ) : null}
        <p className="mt-6 text-xs text-neutral-500">
          {t.rich("video.locked.sharedWith", { app: APP_NAME }, { a: (children) => <a href={HOSTED_EDITION ? "/" : "https://vertov.app"} className="font-medium text-neutral-700 hover:underline">{children}</a> })}
        </p>
      </div>
    </main>
  )
}
