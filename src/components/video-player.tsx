import { CAPTION_LANGUAGES } from "@/lib/caption-languages"
import "@videojs/react/video/skin.css"
import { createPlayer } from "@videojs/react"
import { Video, VideoSkin, videoFeatures } from "@videojs/react/video"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import type { Box } from "@/lib/stage"
import { CursorLayer, useCursorTrack } from "@/components/cursor-layer"
import type { CursorSettings } from "@/lib/cursor"
import { zoomAt } from "@/lib/zooms"
import type { ZoomPoint } from "@/lib/zooms"

interface VideoPlayerProps {
  src: string
  poster?: string
  className?: string
  style?: CSSProperties
  layout?: "responsive" | "fill"
  initialTime?: number
  subtitlesUrl?: string
  /** Storyboard WebVTT for hover-scrub thumbnail previews. */
  thumbnailsUrl?: string
  onActivate?: (element: HTMLVideoElement) => void
  onTimeUpdate?: (currentTime: number, element: HTMLVideoElement) => void
  onEnded?: (element: HTMLVideoElement) => void
  /** Stage composition: a fixed aspect, a background, and where the screen sits (percent). */
  stageAspect?: number
  stageBackground?: string
  screenBox?: Box | null
  zooms?: ZoomPoint[]
  /** Pointer style drawn from the recording's saved mouse path at `cursorUrl`. */
  cursor?: CursorSettings
  cursorUrl?: string
  onPickZoomFocus?: (x: number, y: number) => void
  /** Layers drawn over the video inside the player, so they go fullscreen with it. */
  children?: ReactNode
}

// One store definition for every player on the page; each <Player.Provider>
// below creates its own isolated instance of it.
const Player = createPlayer({ features: videoFeatures })

/**
 * The share page's player: Video.js v10's packaged frosted-glass video
 * skin around a native video element we control, so captions, poster,
 * and time callbacks stay wired to our own data.
 */
export function VideoPlayer({
  src,
  poster,
  className,
  style,
  layout = "responsive",
  initialTime = 0,
  subtitlesUrl,
  thumbnailsUrl,
  onActivate,
  onTimeUpdate,
  onEnded,
  stageAspect,
  stageBackground,
  screenBox,
  zooms,
  cursor,
  cursorUrl,
  onPickZoomFocus,
  children,
}: VideoPlayerProps) {
  const [languages, setLanguages] = useState<string[]>([])
  useEffect(() => {
    setLanguages([])
    if (!subtitlesUrl) return
    let cancelled = false
    void fetch(`${subtitlesUrl}?languages=1`).then((r) => r.json() as Promise<{ languages?: string[] }>).then((body) => { if (!cancelled) setLanguages(body.languages ?? []) }).catch(() => {})
    return () => { cancelled = true }
  }, [subtitlesUrl])
  const videoRef = useRef<HTMLVideoElement>(null)
  const cursorTrack = useCursorTrack(cursor ? cursorUrl : undefined)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  useEffect(() => setVideoEl(videoRef.current), [src])
  const [startingTime] = useState(initialTime)
  const [aspectRatio, setAspectRatio] = useState<string>()
  const [captionText, setCaptionText] = useState("")
  const hasAppliedInitialTimeRef = useRef(false)
  // True while finding the length of a file that doesn't state it; time callbacks are held back meanwhile.
  const probingRef = useRef(false)
  const hasZooms = Boolean(zooms?.length)
  const pickingFocus = Boolean(onPickZoomFocus)

  // Native cues would scale and leave the crop with the video; keep the selected track on a fixed layer.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !hasZooms) { setCaptionText(""); return }
    const watched = new Set<TextTrack>()
    function update() {
      if (!video) return
      const texts: string[] = []
      for (const track of Array.from(video.textTracks)) {
        if (!watched.has(track)) { track.addEventListener("cuechange", update); watched.add(track) }
        if (track.mode !== "showing" || !["captions", "subtitles"].includes(track.kind)) continue
        for (const cue of Array.from(track.activeCues ?? [])) {
          if (cue instanceof VTTCue) texts.push(cue.getCueAsHTML().textContent ?? "")
        }
      }
      setCaptionText(texts.join("\n"))
    }
    video.textTracks.addEventListener("change", update)
    video.textTracks.addEventListener("addtrack", update)
    video.textTracks.addEventListener("removetrack", update)
    update()
    return () => {
      video.textTracks.removeEventListener("change", update)
      video.textTracks.removeEventListener("addtrack", update)
      video.textTracks.removeEventListener("removetrack", update)
      for (const track of watched) track.removeEventListener("cuechange", update)
    }
  }, [hasZooms, languages, src])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!zooms?.length && !pickingFocus) { video.style.transform = ""; return }
    let frame = 0
    function draw() {
      if (!video) return
      const zoom = pickingFocus ? { scale: 1, x: 0, y: 0 } : zoomAt(zooms ?? [], video.currentTime)
      video.style.transform = `translate(${zoom.x * 100}%, ${zoom.y * 100}%) scale(${zoom.scale})`
    }
    function animate() {
      draw()
      if (video && !video.paused && !video.ended) frame = requestAnimationFrame(animate)
    }
    function start() { cancelAnimationFrame(frame); animate() }
    video.addEventListener("play", start)
    video.addEventListener("timeupdate", draw)
    video.addEventListener("seeking", draw)
    video.addEventListener("loadedmetadata", draw)
    if (pickingFocus) video.pause()
    start()
    return () => {
      cancelAnimationFrame(frame)
      video.removeEventListener("play", start)
      video.removeEventListener("timeupdate", draw)
      video.removeEventListener("seeking", draw)
      video.removeEventListener("loadedmetadata", draw)
    }
  }, [zooms, pickingFocus])

  const mergedStyle = useMemo(() => {
    const background = stageBackground ? { background: stageBackground } : {}
    if (layout !== "responsive") return { ...style, ...background }
    const ratio = stageAspect ? String(stageAspect) : aspectRatio ?? "16 / 9"
    return { ...style, ...background, ...(ratio ? { aspectRatio: ratio } : {}) }
  }, [aspectRatio, layout, stageAspect, stageBackground, style])

  // Framed layouts float the screen inside the stage with rounded corners.
  const framed =
    screenBox !== undefined &&
    (screenBox === null ||
      screenBox.left !== 0 ||
      screenBox.top !== 0 ||
      screenBox.width !== 100 ||
      screenBox.height !== 100)
  const frameStyle: CSSProperties =
    screenBox === null
      ? { position: "absolute", inset: 0, opacity: 0, pointerEvents: "none" }
      : framed
        ? {
            position: "absolute",
            left: `${screenBox.left}%`,
            top: `${screenBox.top}%`,
            width: `${screenBox.width}%`,
            height: `${screenBox.height}%`,
            borderRadius: 12,
            boxShadow: "0 24px 60px -12px rgb(0 0 0 / 0.45)",
            background: "#000",
          }
        : { position: "absolute", inset: 0 }

  // The theater-mode layout swap remounts the player; picking the start
  // time up from the previous instance keeps playback continuous.
  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    const handleLoadedMetadata = () => {
      if (element.videoWidth > 0 && element.videoHeight > 0) {
        setAspectRatio(`${element.videoWidth} / ${element.videoHeight}`)
      }
      // Browser recordings (MediaRecorder WebM) carry no length, so duration reads Infinity and the player can't
      // show the end time or move its progress bar. Seeking far past the end makes the browser work it out.
      if (element.duration === Infinity && !probingRef.current) {
        probingRef.current = true
        const settle = () => {
          if (!Number.isFinite(element.duration)) return
          element.removeEventListener("durationchange", settle)
          element.removeEventListener("timeupdate", settle)
          probingRef.current = false
          element.currentTime = 0
          handleLoadedMetadata()
        }
        element.addEventListener("durationchange", settle)
        element.addEventListener("timeupdate", settle)
        element.currentTime = Number.MAX_SAFE_INTEGER
        return
      }
      if (probingRef.current) return
      if (!hasAppliedInitialTimeRef.current && startingTime > 0) {
        try {
          element.currentTime = startingTime
          hasAppliedInitialTimeRef.current = true
        } catch {
          // Not seekable yet; the media element will honor later seeks.
        }
      }
      onActivate?.(element)
      onTimeUpdate?.(element.currentTime, element)
    }

    if (element.readyState >= 1) {
      handleLoadedMetadata()
    } else {
      element.addEventListener("loadedmetadata", handleLoadedMetadata)
    }
    return () => {
      element.removeEventListener("loadedmetadata", handleLoadedMetadata)
    }
  }, [onActivate, onTimeUpdate, startingTime])

  return (
    <Player.Provider>
      <VideoSkin
        poster={poster}
        className={[`video-player video-player--${layout}`, className]
          .filter(Boolean)
          .join(" ")}
        style={mergedStyle}
      >
        <div style={{ ...frameStyle, overflow: "hidden" }}>
        <Video
          ref={videoRef}
          src={src}
          className={hasZooms ? "video-zoom-captions" : undefined}
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          style={{ width: "100%", height: "100%", objectFit: "contain", transformOrigin: "0 0" }}
          onEnded={(event) => { if (!probingRef.current) onEnded?.(event.currentTarget) }}
          onTimeUpdate={(event) => {
            if (probingRef.current) return
            const element = event.currentTarget
            onActivate?.(element)
            onTimeUpdate?.(element.currentTime, element)
          }}
          onPlay={(event) => onActivate?.(event.currentTarget)}
          onPause={(event) => onActivate?.(event.currentTarget)}
        >
          {subtitlesUrl && (
            <track
              kind="captions"
              label="Original"
              srcLang="en"
              src={subtitlesUrl}
            />
          )}
          {languages.map((language) => <track key={language} kind="subtitles" label={CAPTION_LANGUAGES[language]} srcLang={language} src={`${subtitlesUrl}?lang=${language}`} />)}
          {thumbnailsUrl && (
            <track
              kind="metadata"
              label="thumbnails"
              src={thumbnailsUrl}
              default
            />
          )}
        </Video>
        {cursor && cursorTrack && <CursorLayer video={videoEl} track={cursorTrack} settings={cursor} zooms={zooms} />}
        {hasZooms && captionText && <div className="pointer-events-none absolute inset-x-4 bottom-12 z-10 text-center"><span className="whitespace-pre-line rounded bg-black/80 px-2 py-1 text-sm text-white sm:text-base">{captionText}</span></div>}
        {onPickZoomFocus && <button type="button" aria-label="Pick zoom focus on the screen" className="absolute inset-0 z-20 cursor-crosshair border-2 border-dashed border-white/70 bg-black/10" onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onPickZoomFocus(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)))
        }}><span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-black/80 px-3 py-1 text-xs text-white">Click a focus point</span></button>}
        </div>
        {children}
      </VideoSkin>
    </Player.Provider>
  )
}
