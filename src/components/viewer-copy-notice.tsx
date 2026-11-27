import { Button } from "@cloudflare/kumo/components/button"
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n/react"

/** Stands in for the player while the copy without the removed footage is being made. */
export function ViewerCopyHeld({ aspect }: { aspect?: number }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), 20_000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div role="status" className="flex size-full items-center justify-center bg-neutral-900 p-6 text-center text-sm text-neutral-300" style={aspect ? { aspectRatio: String(aspect) } : undefined}>
      {t("video.copy.updating")}
    </div>
  )
}

/** Tells the people who edit a video what viewers are getting after a trim or cut. */
export function ViewerCopyNotice({ uploadId, held, failed, changed }: { uploadId: string; held: boolean; failed: boolean; changed: boolean }) {
  const t = useT()
  const [retried, setRetried] = useState(false)
  const broken = failed && !retried && !changed
  if (!held && !changed) return null
  async function retry() {
    const response = await fetch(`/api/recordings/${uploadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retryViewerCopy: true }),
    }).catch(() => null)
    if (response?.ok) setRetried(true)
  }
  return (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
      <span>{t(broken ? "video.copy.failed" : changed ? "video.copy.changed" : "video.copy.waiting")}</span>
      {broken && (
        <Button size="sm" variant="secondary" onClick={() => void retry()}>
          {t("video.copy.retry")}
        </Button>
      )}
    </div>
  )
}
