import { useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { cutSeconds, normalizeCuts } from "@/lib/cuts"
import type { Cut } from "@/lib/cuts"
import { formatDuration } from "@/lib/format"
import { useT } from "@/lib/i18n/react"

/** The least video a trim may leave, matching the API. */
const MIN_KEEP = 1
const round = (seconds: number) => Math.round(seconds * 10) / 10
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

type Handle = "start" | "end" | "selA" | "selB"

/**
 * The video as one bar: drag the red handles to trim the ends, click or drag along the bar to move the
 * playhead, and use "Cut a section" to remove a stretch from the middle. Trims save when a handle is let
 * go; cuts are the same ones the transcript editor makes, so both stay in step.
 */
export function TrimTimeline({
  duration,
  currentTime,
  trimStart,
  trimEnd,
  cuts,
  onSeek,
  onTrim,
  onCutsChange,
}: {
  duration: number
  currentTime: number
  trimStart: number | null
  trimEnd: number | null
  cuts: Array<Cut>
  onSeek: (time: number) => void
  onTrim: (patch: { trimStart?: number | null; trimEnd?: number | null }) => void
  onCutsChange: (next: Array<Cut>) => void
}) {
  const t = useT()
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef<Handle | "scrub" | null>(null)
  const [live, setLive] = useState<{ start: number; end: number } | null>(null)
  const [selection, setSelection] = useState<[number, number] | null>(null)

  if (!(duration > 0)) return null

  const start = live?.start ?? trimStart ?? 0
  const end = live?.end ?? trimEnd ?? duration
  const pct = (seconds: number) => `${(clamp(seconds, 0, duration) / duration) * 100}%`
  const width = (from: number, to: number) => `${(Math.max(to - from, 0) / duration) * 100}%`

  function timeAt(clientX: number) {
    const rect = track.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration)
  }

  function move(handle: Handle, seconds: number) {
    if (handle === "start") setLive({ start: clamp(seconds, 0, end - MIN_KEEP), end })
    else if (handle === "end") setLive({ start, end: clamp(seconds, start + MIN_KEEP, duration) })
    else if (selection) {
      const other = handle === "selA" ? selection[1] : selection[0]
      setSelection(handle === "selA" ? [seconds, other] : [other, seconds])
    }
  }

  function grab(handle: Handle, event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = handle
  }

  function drag(event: ReactPointerEvent<HTMLElement>) {
    const handle = dragging.current
    if (!handle) return
    if (handle === "scrub") onSeek(timeAt(event.clientX))
    else move(handle, timeAt(event.clientX))
  }

  function release() {
    const handle = dragging.current
    dragging.current = null
    if (handle === "start" || handle === "end") {
      if (!live) return
      const nextStart = live.start <= 0.2 ? null : round(live.start)
      const nextEnd = live.end >= duration - 0.2 ? null : round(live.end)
      const patch: { trimStart?: number | null; trimEnd?: number | null } = {}
      if (nextStart !== trimStart) patch.trimStart = nextStart
      if (nextEnd !== trimEnd) patch.trimEnd = nextEnd
      setLive(null)
      if (Object.keys(patch).length) onTrim(patch)
    }
  }

  function nudge(handle: "start" | "end", event: React.KeyboardEvent) {
    const step = event.shiftKey ? 1 : 0.1
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
    if (!direction) return
    event.preventDefault()
    const target = round((handle === "start" ? start : end) + direction * step)
    const bounded = handle === "start" ? clamp(target, 0, end - MIN_KEEP) : clamp(target, start + MIN_KEEP, duration)
    if (handle === "start") onTrim({ trimStart: bounded <= 0.2 ? null : bounded })
    else onTrim({ trimEnd: bounded >= duration - 0.2 ? null : bounded })
  }

  function beginSelection() {
    const from = clamp(currentTime, start, Math.max(start, end - MIN_KEEP))
    setSelection([from, Math.min(from + 2, end)])
  }

  function applySelection() {
    if (!selection) return
    const [a, b] = selection[0] <= selection[1] ? selection : [selection[1], selection[0]]
    if (b - a < 0.1) return setSelection(null)
    onCutsChange(normalizeCuts([...cuts, [round(a), round(b)]], duration))
    setSelection(null)
  }

  const selected = selection ? (selection[0] <= selection[1] ? selection : ([selection[1], selection[0]] as [number, number])) : null
  const removed = cutSeconds(cuts.map(([from, to]): Cut => [clamp(from, start, end), clamp(to, start, end)]))
  const finalLength = Math.max(end - start - removed, 0)
  const trimmed = trimStart != null || trimEnd != null

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={track}
        role="presentation"
        className="relative h-14 cursor-pointer touch-none select-none rounded-lg bg-neutral-200"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = "scrub"
          onSeek(timeAt(event.clientX))
        }}
        onPointerMove={drag}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div className="absolute inset-y-0 rounded-md border-y-2 border-red-300 bg-red-50" style={{ left: pct(start), width: width(start, end) }} />
        {cuts.map((cut) => (
          <button
            key={`${cut[0]}-${cut[1]}`}
            type="button"
            title={t("video.trim.cutTitle", { from: formatDuration(cut[0]), to: formatDuration(cut[1]) })}
            aria-label={t("video.trim.cutRestoreLabel", { from: formatDuration(cut[0]), to: formatDuration(cut[1]) })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onCutsChange(cuts.filter((other) => other !== cut))}
            className="absolute inset-y-0 min-w-1 cursor-pointer border-x border-neutral-500 bg-[repeating-linear-gradient(135deg,#a3a3a3_0_3px,#e5e5e5_3px_6px)] hover:bg-[repeating-linear-gradient(135deg,#737373_0_3px,#d4d4d4_3px_6px)]"
            style={{ left: pct(cut[0]), width: width(cut[0], cut[1]) }}
          />
        ))}
        {selected && (
          <div className="pointer-events-none absolute inset-y-0 border-2 border-dashed border-neutral-900 bg-neutral-900/15" style={{ left: pct(selected[0]), width: width(selected[0], selected[1]) }} />
        )}
        <div className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded bg-neutral-900" style={{ left: pct(currentTime) }} />
        {(["start", "end"] as const).map((edge) => {
          const at = edge === "start" ? start : end
          return (
            <div
              key={edge}
              role="slider"
              tabIndex={0}
              aria-label={edge === "start" ? t("video.trim.start") : t("video.trim.end")}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={at}
              aria-valuetext={formatDuration(at)}
              onPointerDown={(event) => grab(edge, event)}
              onPointerMove={drag}
              onPointerUp={release}
              onPointerCancel={release}
              onKeyDown={(event) => nudge(edge, event)}
              className="absolute inset-y-0 z-10 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded bg-red-600 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900"
              style={{ left: pct(at) }}
            >
              <span className="h-5 w-0.5 rounded bg-white/80" />
            </div>
          )
        })}
        {selected &&
          (["selA", "selB"] as const).map((handle, index) => (
            <div
              key={handle}
              role="slider"
              tabIndex={0}
              aria-label={index === 0 ? t("video.trim.selectionEdgeOne") : t("video.trim.selectionEdgeOther")}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={selection ? selection[index] : 0}
              onPointerDown={(event) => grab(handle, event)}
              onPointerMove={drag}
              onPointerUp={release}
              onPointerCancel={release}
              className="absolute inset-y-0 z-10 w-2.5 -translate-x-1/2 cursor-ew-resize rounded bg-neutral-900"
              style={{ left: pct(selection ? selection[index] : 0) }}
            />
          ))}
      </div>

      <div className="flex items-center justify-between text-xs tabular-nums text-neutral-500">
        <span>{formatDuration(start)}</span>
        <span className="text-neutral-800">
          {cuts.length > 0
            ? t("video.trim.finalLengthWithCuts", { length: formatDuration(finalLength), count: cuts.length, removed: formatDuration(removed) })
            : t("video.trim.finalLength", { length: formatDuration(finalLength) })}
        </span>
        <span>{formatDuration(end)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {selected ? (
          <>
            <button type="button" onClick={applySelection} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">
              {t("video.trim.cutRange", { from: formatDuration(selected[0]), to: formatDuration(selected[1]) })}
            </button>
            <button type="button" onClick={() => setSelection(null)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button type="button" onClick={beginSelection} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
            {t("video.trim.cutSection")}
          </button>
        )}
        {trimmed && (
          <button type="button" onClick={() => onTrim({ trimStart: null, trimEnd: null })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
            {t("video.trim.reset")}
          </button>
        )}
        {cuts.length > 0 && (
          <button type="button" onClick={() => onCutsChange([])} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
            {t("video.trim.restoreAllCuts")}
          </button>
        )}
      </div>
    </div>
  )
}
