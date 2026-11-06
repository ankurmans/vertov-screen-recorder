import { useEffect, useRef, useState } from "react"
import type { Box, BubbleShape, StageLayout, StageStyle } from "@/lib/stage"
import { SCALE_RANGE } from "@/lib/stage"
import { VertovIcon } from "@/components/vertov-icon"
import { ReactionIcon } from "@/components/reaction-icon"

/**
 * Generated narration, kept in lockstep with the screen video like the camera track. It starts `offset` seconds
 * into the recording, follows volume and mute, and the recording's cuts apply to it because it follows the video.
 */
export function VoiceTrack({ src, main, offset }: { src: string; main: HTMLVideoElement | null; offset: number }) {
  const ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const voice = ref.current
    if (!main || !voice) return
    const target = () => main.currentTime - offset
    const sync = (force = false) => {
      const wanted = target()
      if (wanted < 0) {
        voice.pause()
        return
      }
      if (force || Math.abs(voice.currentTime - wanted) > 0.25) {
        try {
          voice.currentTime = wanted
        } catch {
          // Not seekable yet.
        }
      }
      if (!main.paused && voice.paused && !voice.ended) void voice.play().catch(() => {})
    }
    const onPlay = () => sync(true)
    const onPause = () => {
      voice.pause()
      sync(true)
    }
    const onVolume = () => {
      voice.volume = main.volume
      voice.muted = main.muted
    }
    const onRate = () => {
      voice.playbackRate = main.playbackRate
    }
    const onWaiting = () => voice.pause()
    const onSeeked = () => sync(true)
    const onTime = () => sync()
    main.addEventListener("play", onPlay)
    main.addEventListener("playing", onPlay)
    main.addEventListener("pause", onPause)
    main.addEventListener("seeked", onSeeked)
    main.addEventListener("timeupdate", onTime)
    main.addEventListener("volumechange", onVolume)
    main.addEventListener("ratechange", onRate)
    main.addEventListener("waiting", onWaiting)
    onVolume()
    onRate()
    sync(true)
    return () => {
      voice.pause()
      main.removeEventListener("play", onPlay)
      main.removeEventListener("playing", onPlay)
      main.removeEventListener("pause", onPause)
      main.removeEventListener("seeked", onSeeked)
      main.removeEventListener("timeupdate", onTime)
      main.removeEventListener("volumechange", onVolume)
      main.removeEventListener("ratechange", onRate)
      main.removeEventListener("waiting", onWaiting)
    }
  }, [main, src, offset])

  return <audio ref={ref} src={src} preload="auto" className="hidden" />
}

/**
 * The camera track, kept in lockstep with the screen video. The screen
 * element owns time and audio; this one follows play, pause, seeks and
 * speed, and nudges itself back when it drifts.
 *
 * When editable, the owner drags the bubble anywhere and resizes it from its
 * corner handle; in the side and split layouts, dragging moves the camera to
 * the other edge.
 */
export function CameraTrack({
  src,
  main,
  box,
  layout,
  shape,
  stageAspect,
  editable,
  onStyleChange,
}: {
  src: string
  main: HTMLVideoElement | null
  box: Box
  layout: StageLayout
  shape: BubbleShape
  /** Stage width / height, to keep card corners round on a non-square box. */
  stageAspect: number
  editable: boolean
  onStyleChange?: (patch: Partial<StageStyle>) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  // Resizing previews as a scale from the bottom-left corner, so the card follows the top-right handle.
  const [resize, setResize] = useState<number | null>(null)
  const resizeStart = useRef<{ x: number; y: number; left: number; bottom: number; width: number; height: number; max: number } | null>(null)

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

  const full = layout === "camera" || layout === "split"
  const movable = editable && (layout === "bubble" || layout === "side" || layout === "split")
  // Percent radii are per axis, so scale the vertical one to keep corners circular on a card.
  const pxRatio = (box.width / box.height) * stageAspect
  const radius = full
    ? 0
    : layout === "bubble" && shape === "circle"
      ? "9999px"
      : `${layout === "bubble" && shape === "rounded" ? 14 : 10}% / ${(layout === "bubble" && shape === "rounded" ? 14 : 10) * pxRatio}%`

  const stageOf = (element: HTMLElement) => element.parentElement?.getBoundingClientRect()
  // Up and to the right grows it; whichever way moved further wins.
  const resizeFactor = (event: React.PointerEvent, start: NonNullable<typeof resizeStart.current>) => {
    const grow = Math.max(event.clientX - start.x, (start.y - event.clientY) * (start.width / start.height))
    return Math.min(start.max, Math.max(24 / start.width, (start.width + grow) / start.width))
  }
  return (
    <div
      className={`absolute overflow-hidden ${full ? "" : "shadow-[0_12px_32px_-8px_rgb(0_0_0/0.55)] ring-2 ring-white/80"} ${
        movable ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none"
      }`}
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
        borderRadius: radius,
        transform: drag ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.03)` : resize ? `scale(${resize})` : undefined,
        transformOrigin: resize ? "bottom left" : undefined,
        transition: drag || resize ? "none" : "left 300ms cubic-bezier(.2,.8,.2,1), top 300ms cubic-bezier(.2,.8,.2,1), width 300ms, height 300ms, border-radius 300ms",
        zIndex: 5,
      }}
      onPointerDown={(event) => {
        if (!movable) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        const rect = event.currentTarget.getBoundingClientRect()
        dragStart.current = { x: event.clientX, y: event.clientY, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
        setDrag({ dx: 0, dy: 0 })
      }}
      onPointerMove={(event) => {
        if (!dragStart.current) return
        setDrag({ dx: event.clientX - dragStart.current.x, dy: event.clientY - dragStart.current.y })
      }}
      onPointerUp={(event) => {
        const start = dragStart.current
        if (!start) return
        const stage = stageOf(event.currentTarget)
        // From the drop point, not the last move event, which can lag behind it.
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        dragStart.current = null
        setDrag(null)
        if (!stage || Math.hypot(dx, dy) < 3) return
        const x = ((start.cx + dx - stage.left) / stage.width) * 100
        const y = ((start.cy + dy - stage.top) / stage.height) * 100
        if (layout === "bubble") onStyleChange?.({ x: round(x), y: round(y) })
        else onStyleChange?.({ side: x < 50 ? "left" : "right" })
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
        className="pointer-events-none size-full"
        // Inline, because the player skin sets object-fit: contain on every video inside it.
        style={{ objectFit: "cover" }}
      />
      {editable && layout === "bubble" && (
        <div
          role="slider"
          aria-label="Camera size"
          aria-valuenow={Math.round(box.width)}
          title="Drag to resize"
          className="absolute top-[6%] right-[6%] size-5 cursor-nesw-resize touch-none rounded-full border-2 border-white bg-neutral-900/70 shadow"
          onPointerDown={(event) => {
            event.stopPropagation()
            const bubbleElement = event.currentTarget.parentElement
            const bubble = bubbleElement?.getBoundingClientRect()
            const stage = bubbleElement ? stageOf(bubbleElement) : undefined
            if (!bubble || !stage) return
            event.currentTarget.setPointerCapture(event.pointerId)
            resizeStart.current = {
              x: event.clientX,
              y: event.clientY,
              left: bubble.left,
              bottom: bubble.bottom,
              width: bubble.width,
              height: bubble.height,
              max: (SCALE_RANGE.max * stage.width) / bubble.width,
            }
            setResize(1)
          }}
          onPointerMove={(event) => {
            const start = resizeStart.current
            if (!start) return
            event.stopPropagation()
            setResize(resizeFactor(event, start))
          }}
          onPointerUp={(event) => {
            const start = resizeStart.current
            if (!start) return
            event.stopPropagation()
            const bubbleElement = event.currentTarget.parentElement
            const stage = bubbleElement ? stageOf(bubbleElement) : undefined
            const factor = resizeFactor(event, start)
            resizeStart.current = null
            setResize(null)
            if (!stage) return
            const width = start.width * factor
            const height = start.height * factor
            const scale = Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, width / stage.width))
            // Bottom-left stays put, as in the preview.
            onStyleChange?.({
              scale: Math.round(scale * 1000) / 1000,
              x: round(((start.left + width / 2 - stage.left) / stage.width) * 100),
              y: round(((start.bottom - height / 2 - stage.top) / stage.height) * 100),
            })
          }}
        />
      )}
    </div>
  )
}

const round = (value: number) => Math.round(value * 10) / 10

export interface FloatingReaction {
  key: string
  emoji: string
  name?: string | null
}

/** A reaction drifting up when someone reacts or playback passes its timestamp. */
export function ReactionLayer({ items }: { items: Array<FloatingReaction> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="reaction-float absolute bottom-16 flex flex-col items-center"
          style={{ right: `${8 + ((index * 37) % 18)}%` }}
        >
          <span className="flex size-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-[var(--brand-accent,#de2b14)]"><ReactionIcon code={item.emoji} size={28} /></span>
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

export function countCtaClick(uploadId: string | undefined) {
  if (uploadId) navigator.sendBeacon?.(`/api/cta/${uploadId}`)
}

/** Shown when the video (or its trimmed end) finishes: replay, and the owner's call to action. */
export function EndCard({
  ctaLabel,
  ctaUrl,
  uploadId,
  onReplay,
}: {
  uploadId?: string
  ctaLabel: string | null
  ctaUrl: string | null
  onReplay: () => void
}) {
  return (
    <div className="end-card absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/65 backdrop-blur-sm">
      {ctaLabel && ctaUrl && (
        <a
          href={ctaUrl}
          onClick={() => countCtaClick(uploadId)}
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
        className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25"
      >
        <VertovIcon name="restart" /> Watch again
      </button>
    </div>
  )
}
