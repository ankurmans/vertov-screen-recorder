import { useEffect, useState } from "react"
import { MAX_ZOOMS, parseZooms, zoomsFromClicks } from "@/lib/zooms"
import type { ZoomClick, ZoomPoint } from "@/lib/zooms"
import { formatDuration } from "@/lib/format"

export type ZoomFocusPicker = ((x: number, y: number) => void) | null

export function ZoomEditor({ uploadId, points, currentTime, duration, onChange, onSeek, onPickFocus, screenVisible }: {
  uploadId: string
  points: ZoomPoint[]
  currentTime: number
  duration: number
  onChange: (points: ZoomPoint[]) => void
  onSeek: (time: number) => void
  onPickFocus: (picker: ZoomFocusPicker) => void
  screenVisible: boolean
}) {
  const [clicks, setClicks] = useState<ZoomClick[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState<ZoomPoint | null>(null)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/zooms/${uploadId}`).then(async (response) => {
      if (!response.ok) throw new Error("Couldn't load recorded clicks. Try reopening Customize.")
      const body = await response.json() as { clicks?: ZoomClick[] }
      if (!cancelled) setClicks(body.clicks ?? [])
    }).catch((reason) => { if (!cancelled) setError(reason.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [uploadId])
  useEffect(() => () => onPickFocus(null), [onPickFocus])

  function select(point: ZoomPoint | null) {
    onPickFocus(null)
    setPicking(false)
    setDraft(point ? { ...point } : null)
    setError("")
    if (point) onSeek(point.start + Math.min(0.5, point.duration / 2))
  }

  function apply(next: ZoomPoint[]) {
    const parsed = parseZooms(next)
    if (parsed.length !== next.length) {
      setError("Zooms need at least one second and cannot overlap. Move the start or shorten the duration.")
      return false
    }
    onChange(parsed)
    setError("")
    return true
  }

  const button = "cursor-pointer rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-100 disabled:cursor-default disabled:opacity-40"
  return (
    <div className="mt-5 border-t border-neutral-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Zoom & focus</h3>
          <p className="mt-1 text-xs text-neutral-500">Smooth zooms in playback and MP4 exports. Your separate camera stays in place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={loading || !clicks.length || points.length >= MAX_ZOOMS} onClick={() => {
            const generated = zoomsFromClicks(clicks, duration).filter((point) => !points.some((p) => point.start < p.start + p.duration && p.start < point.start + point.duration))
              .slice(0, MAX_ZOOMS - points.length)
            if (!generated.length) return setError("No new click zooms fit between your existing zooms.")
            apply([...points, ...generated])
            select(generated[0])
          }}>{loading ? "Loading clicks…" : `Auto zoom from clicks${clicks.length ? ` (${clicks.length})` : ""}`}</button>
          <button type="button" className={button} disabled={!Number.isFinite(duration) || duration < 1 || points.length >= MAX_ZOOMS} onClick={() => {
            const start = Math.min(Math.max(0, currentTime), duration - 1)
            select({ id: crypto.randomUUID(), start, duration: Math.min(3.5, duration - start), x: 0.5, y: 0.5, scale: 1.6 })
          }}>Add at {formatDuration(currentTime)}</button>
        </div>
      </div>
      {!loading && !clicks.length && <p className="mt-2 text-xs text-neutral-500">For automatic zooms, record a tab with extension v0.4.0 or newer and enable Capture clicks. You can add zooms manually to any video.</p>}
      {points.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
        {points.map((point) => <button key={point.id} type="button" onClick={() => select(point)} className={`${button} ${draft?.id === point.id ? "border-neutral-900 bg-neutral-100" : ""}`}>{formatDuration(point.start)} · {point.scale}×</button>)}
        <button type="button" className="cursor-pointer px-2 py-1 text-xs text-neutral-500 hover:text-red-700" onClick={() => { onChange([]); select(null) }}>Remove all zooms</button>
      </div>}
      {draft && <form className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3" onSubmit={(event) => {
        event.preventDefault()
        if (draft.start + draft.duration > duration + 0.01) return setError("This zoom extends past the end of the recording.")
        if (apply([...points.filter((point) => point.id !== draft.id), draft])) select(draft)
      }}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
          {([
            ["start", "Start (seconds)", 0, Math.max(0, duration - 1), "any"],
            ["duration", "Duration (seconds)", 1, 12, "any"],
            ["scale", "Zoom", 1.25, 2.5, 0.05],
            ["x", "Focus left → right", 0, 1, 0.01],
            ["y", "Focus top → bottom", 0, 1, 0.01],
          ] as const).map(([key, label, min, max, step]) => <label key={key} className="text-xs text-neutral-600">{label}
            <input type="number" required min={min} max={Number.isFinite(max) ? max : undefined} step={step} value={Number.isFinite(draft[key]) ? draft[key] : ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.valueAsNumber })} className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-neutral-900" />
          </label>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={button} disabled={!screenVisible} title={screenVisible ? undefined : "Choose a layout with a screen to pick its focus"} onClick={() => {
            if (picking) { onPickFocus(null); setPicking(false); return }
            setPicking(true)
            onPickFocus((x, y) => { setDraft((point) => point ? { ...point, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } : null); setPicking(false) })
          }}>{picking ? "Cancel picking" : "Pick focus on video"}</button>
          <button type="submit" className="cursor-pointer rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700">Apply zoom</button>
          <button type="button" className={button} onClick={() => select(null)}>Done</button>
          {points.some((p) => p.id === draft.id) && <button type="button" className="cursor-pointer px-2 py-1 text-xs text-red-700" onClick={() => { onChange(points.filter((p) => p.id !== draft.id)); select(null) }}>Remove zoom</button>}
          {picking && <span className="text-xs text-neutral-600">Click the part of the screen to focus on, then Apply zoom.</span>}
        </div>
      </form>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
