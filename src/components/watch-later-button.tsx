import { ClockIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

/** Signed-in viewers save a video to come back to; it then shows under Watch later in their library. */
export function WatchLaterButton({ uploadId }: { uploadId: string }) {
  const [saved, setSaved] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/watch-later/${uploadId}`)
      .then((response) => (response.ok ? response.json<{ saved: boolean }>() : null))
      .then((body) => !cancelled && setSaved(body?.saved ?? false))
      .catch(() => !cancelled && setSaved(false))
    return () => {
      cancelled = true
    }
  }, [uploadId])

  async function toggle() {
    if (busy || saved === null) return
    setBusy(true)
    const response = await fetch(`/api/watch-later/${uploadId}`, { method: saved ? "DELETE" : "POST" }).catch(() => null)
    if (response?.ok) setSaved(!saved)
    setBusy(false)
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy || saved === null}
      aria-pressed={saved ?? false}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
        saved ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      <ClockIcon size={16} weight={saved ? "fill" : "regular"} /> {saved ? "Saved" : "Watch later"}
    </button>
  )
}
