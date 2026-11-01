import { useEffect, useRef, useState } from "react"
import type { Box, BubbleCorner, BubbleShape } from "@/lib/stage"

/**
 * The camera track, kept in lockstep with the screen video. The screen
 * element owns time and audio; this one follows play, pause, seeks and
 * speed, and nudges itself back when it drifts.
 */
export function CameraTrack({
  src,
  main,
  box,
  shape,
  full,
  editable,
  onCornerChange,
}: {
  src: string
  main: HTMLVideoElement | null
  box: Box
  shape: BubbleShape
  /** Camera-only layout: fill the stage instead of floating. */
  full: boolean
  editable: boolean
  onCornerChange?: (corner: BubbleCorner) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const camera = ref.current
    if (!main || !camera) return
    const sync = (force = false) => {
      if (force || Math.abs(camera.currentTime - main.currentTime) > 0.25) {
        try {
          camera.currentTime = main.currentTime
        } catch {
          // Not seekable yet.
        }
      }
    }
    const onPlay = () => {
      sync(true)
      void camera.play().catch(() => {})
    }
    const onPause = () => {
      camera.pause()
      sync(true)
    }
    const onSeeked = () => sync(true)
    const onTime = () => sync()
    const onRate = () => {
      camera.playbackRate = main.playbackRate
    }
    const onWaiting = () => camera.pause()
    const onPlaying = () => void camera.play().catch(() => {})
    main.addEventListener("play", onPlay)
    main.addEventListener("pause", onPause)
    main.addEventListener("seeked", onSeeked)
    main.addEventListener("timeupdate", onTime)
    main.addEventListener("ratechange", onRate)
    main.addEventListener("waiting", onWaiting)
    main.addEventListener("playing", onPlaying)
    sync(true)
    if (!main.paused) void camera.play().catch(() => {})
    return () => {
      main.removeEventListener("play", onPlay)
      main.removeEventListener("pause", onPause)
      main.removeEventListener("seeked", onSeeked)
      main.removeEventListener("timeupdate", onTime)
      main.removeEventListener("ratechange", onRate)
      main.removeEventListener("waiting", onWaiting)
      main.removeEventListener("playing", onPlaying)
    }
  }, [main, src])

  const radius = full ? 0 : shape === "circle" ? "9999px" : "14%"
  return (
    <div
      className={`absolute overflow-hidden ${full ? "" : "shadow-[0_12px_32px_-8px_rgb(0_0_0/0.55)] ring-2 ring-white/80"} ${
        editable && !full ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none"
      }`}
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
        borderRadius: radius,
        transform: drag ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.04)` : undefined,
        transition: drag ? "none" : "left 300ms cubic-bezier(.2,.8,.2,1), top 300ms cubic-bezier(.2,.8,.2,1), width 300ms, height 300ms, border-radius 300ms",
        zIndex: 5,
      }}
      onPointerDown={(event) => {
        if (!editable || full) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStart.current = { x: event.clientX, y: event.clientY }
        setDrag({ dx: 0, dy: 0 })
      }}
      onPointerMove={(event) => {
        if (!dragStart.current) return
        setDrag({ dx: event.clientX - dragStart.current.x, dy: event.clientY - dragStart.current.y })
      }}
      onPointerUp={(event) => {
        if (!dragStart.current) return
        const stage = event.currentTarget.parentElement?.getBoundingClientRect()
        const bubble = event.currentTarget.getBoundingClientRect()
        dragStart.current = null
        setDrag(null)
        if (!stage) return
        // Snap to whichever corner the bubble's center was dropped nearest.
        const cx = bubble.left + bubble.width / 2 - stage.left
        const cy = bubble.top + bubble.height / 2 - stage.top
        const corner = `${cy < stage.height / 2 ? "t" : "b"}${cx < stage.width / 2 ? "l" : "r"}` as BubbleCorner
        onCornerChange?.(corner)
      }}
      onClick={(event) => editable && event.stopPropagation()}
    >
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        className="pointer-events-none size-full object-cover"
      />
    </div>
  )
}

export interface FloatingReaction {
  key: string
  emoji: string
  name?: string | null
}

/** Emoji drifting up over the video when someone reacts or playback passes a reaction. */
export function ReactionLayer({ items }: { items: Array<FloatingReaction> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="reaction-float absolute bottom-16 flex flex-col items-center"
          style={{ right: `${8 + ((index * 37) % 18)}%` }}
        >
          <span className="text-4xl drop-shadow-lg">{item.emoji}</span>
          {item.name && (
            <span className="mt-0.5 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">
              {item.name}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** Shown when the video (or its trimmed end) finishes: replay, and the owner's call to action. */
export function EndCard({
  ctaLabel,
  ctaUrl,
  onReplay,
}: {
  ctaLabel: string | null
  ctaUrl: string | null
  onReplay: () => void
}) {
  return (
    <div className="end-card absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/65 backdrop-blur-sm">
      {ctaLabel && ctaUrl && (
        <a
          href={ctaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-white px-6 py-3 text-base font-semibold text-neutral-900 shadow-lg transition-transform hover:scale-105"
        >
          {ctaLabel}
        </a>
      )}
      <button
        type="button"
        onClick={onReplay}
        className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25"
      >
        ↺ Watch again
      </button>
    </div>
  )
}
