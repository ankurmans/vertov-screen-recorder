import { useEffect, useRef, useState } from "react"
import { CURSOR_ART, clickProgress, cursorAt, cursorIdle, cursorPx } from "@/lib/cursor"
import type { CursorSettings, CursorTrack } from "@/lib/cursor"
import { zoomAt } from "@/lib/zooms"
import type { ZoomPoint } from "@/lib/zooms"

/** Loads a recording's saved mouse path; null while loading or when the recording has none. */
export function useCursorTrack(url: string | undefined): CursorTrack | null {
  const [track, setTrack] = useState<CursorTrack | null>(null)
  useEffect(() => {
    setTrack(null)
    if (!url) return
    let cancelled = false
    void fetch(url, { credentials: "include" })
      .then((response) => (response.ok ? (response.json() as Promise<CursorTrack>) : null))
      .then((body) => { if (!cancelled && body && Array.isArray(body.points)) setTrack(body) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [url])
  return track
}

/** The pointer, drawn over the picture and zoomed with it. Position is written straight to the DOM every frame. */
export function CursorLayer({ video, track, settings, zooms }: { video: HTMLVideoElement | null; track: CursorTrack; settings: CursorSettings; zooms?: ZoomPoint[] }) {
  const stage = useRef<HTMLDivElement>(null)
  const pointer = useRef<HTMLDivElement>(null)
  const art = useRef<SVGSVGElement>(null)
  const fx = useRef<HTMLDivElement>(null)
  const spot = useRef<HTMLDivElement>(null)
  const def = CURSOR_ART[settings.style]

  useEffect(() => {
    if (!video) return
    let frame = 0
    function draw() {
      const box = stage.current
      const mark = pointer.current
      if (!video || !box || !mark || !art.current || !fx.current || !spot.current) return
      const zoom = zoomAt(zooms ?? [], video.currentTime)
      box.style.transform = zooms?.length ? `translate(${zoom.x * 100}%, ${zoom.y * 100}%) scale(${zoom.scale})` : ""
      const t = video.currentTime
      const at = cursorAt(track, t, settings.smooth)
      const hidden = !at || (settings.idle && cursorIdle(track, t))
      mark.style.opacity = hidden ? "0" : "1"
      spot.current.style.opacity = hidden || !settings.spot ? "0" : "1"
      if (!at) return
      const width = box.clientWidth
      const px = cursorPx(settings.size, width)
      const click = clickProgress(track, t)
      const scale = px / 128
      mark.style.transform = `translate(${at.x * width - def.hot[0] * scale}px, ${at.y * box.clientHeight - def.hot[1] * scale}px) scale(${scale})`
      const pressed = Boolean(click && click.p < 0.3)
      const next = pressed && def.press ? def.press : def.idle
      if (art.current.dataset.pose !== (pressed ? "press" : "idle")) {
        art.current.innerHTML = next
        art.current.dataset.pose = pressed ? "press" : "idle"
      }
      spot.current.style.background = `radial-gradient(circle ${px * 3}px at ${at.x * 100}% ${at.y * 100}%, transparent 0, transparent 60%, rgb(0 0 0 / .55) 100%)`
      if (click && settings.fx !== "none") {
        const size = px * (settings.fx === "ring" ? 0.5 + click.p * 1.6 : 0.4 + click.p * 1.9)
        const f = fx.current.style
        f.opacity = String(1 - click.p)
        f.width = f.height = `${size}px`
        f.transform = `translate(${click.x * width - size / 2}px, ${click.y * box.clientHeight - size / 2}px)`
        f.border = settings.fx === "ring" ? `${Math.max(2, px / 14)}px solid #dc2626` : "0"
        f.background = settings.fx === "pulse" ? "rgb(220 38 38 / .45)" : "transparent"
      } else fx.current.style.opacity = "0"
    }
    function loop() {
      draw()
      if (!video!.paused && !video!.ended) frame = requestAnimationFrame(loop)
    }
    function start() { cancelAnimationFrame(frame); loop() }
    video.addEventListener("play", start)
    for (const name of ["timeupdate", "seeking", "seeked", "loadedmetadata"]) video.addEventListener(name, draw)
    start()
    return () => {
      cancelAnimationFrame(frame)
      video.removeEventListener("play", start)
      for (const name of ["timeupdate", "seeking", "seeked", "loadedmetadata"]) video.removeEventListener(name, draw)
    }
  }, [video, track, settings, zooms, def])

  return (
    <div ref={stage} aria-hidden className="pointer-events-none absolute inset-0 z-[5]" style={{ transformOrigin: "0 0" }}>
      <div ref={spot} className="absolute inset-0 opacity-0" />
      <div ref={fx} className="absolute left-0 top-0 rounded-full opacity-0" />
      <div ref={pointer} className="absolute left-0 top-0 size-32 origin-top-left" style={{ willChange: "transform" }}>
        <svg ref={art} viewBox="0 0 128 128" width="128" height="128" dangerouslySetInnerHTML={{ __html: def.idle }} />
      </div>
    </div>
  )
}
