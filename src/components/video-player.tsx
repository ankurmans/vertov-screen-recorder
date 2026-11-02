import { CAPTION_LANGUAGES } from "@/lib/caption-languages"
import "@videojs/react/video/skin.css"
import { createPlayer } from "@videojs/react"
import { Video, VideoSkin, videoFeatures } from "@videojs/react/video"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import type { Box } from "@/lib/stage"

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
  const [startingTime] = useState(initialTime)
  const [aspectRatio, setAspectRatio] = useState<string>()
  const hasAppliedInitialTimeRef = useRef(false)

  const mergedStyle = useMemo(() => {
    const background = stageBackground ? { background: stageBackground } : {}
    if (layout !== "responsive") return { ...style, ...background }
    const ratio = stageAspect ? String(stageAspect) : aspectRatio
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
  const videoStyle: CSSProperties | undefined =
    screenBox === null
      ? { opacity: 0 }
      : framed
        ? {
            position: "absolute",
            left: `${screenBox.left}%`,
            top: `${screenBox.top}%`,
            width: `${screenBox.width}%`,
            height: `${screenBox.height}%`,
            objectFit: "contain",
            borderRadius: 12,
            boxShadow: "0 24px 60px -12px rgb(0 0 0 / 0.45)",
            background: "#000",
          }
        : undefined

  // The theater-mode layout swap remounts the player; picking the start
  // time up from the previous instance keeps playback continuous.
  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    const handleLoadedMetadata = () => {
      if (element.videoWidth > 0 && element.videoHeight > 0) {
        setAspectRatio(`${element.videoWidth} / ${element.videoHeight}`)
      }
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
        <Video
          ref={videoRef}
          src={src}
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          style={videoStyle}
          onEnded={(event) => onEnded?.(event.currentTarget)}
          onTimeUpdate={(event) => {
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
        {children}
      </VideoSkin>
    </Player.Provider>
  )
}
