import { useEffect, useMemo, useState } from "react"
import type { CaptionStyle } from "@/lib/caption-styles"
import { phrasesOf } from "@/lib/caption-phrases"
import type { Transcript } from "@/lib/transcript"

/**
 * Styled captions drawn over the stage from the transcript. Viewers can switch them off with the CC
 * chip. "off" means the player's own captions button, handled elsewhere.
 */
export function CaptionLayer({
  transcript,
  time: coarseTime,
  video,
  style,
}: {
  transcript: Transcript
  time: number
  /** The playing video, read every frame so karaoke words light up on time. */
  video?: HTMLVideoElement | null
  style: Exclude<CaptionStyle, "off">
}) {
  const [nativeCaption, setNativeCaption] = useState(false)
  useEffect(() => {
    if (!video) return
    const update = () => setNativeCaption(Array.from(video.textTracks).some((track) => (track.kind === "subtitles" || track.kind === "captions") && track.mode === "showing"))
    video.textTracks.addEventListener("change", update)
    update()
    return () => video.textTracks.removeEventListener("change", update)
  }, [video])
  const [on, setOn] = useState(true)
  const [liveTime, setLiveTime] = useState(coarseTime)
  useEffect(() => {
    if (style !== "karaoke" || !video) return
    let frame = 0
    const tick = () => {
      setLiveTime(video.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [style, video])
  const time = style === "karaoke" && video ? liveTime : coarseTime
  // Captions read as short phrases, not whole segments: split on sentence ends, pauses and length.
  const phrases = useMemo(() => phrasesOf(transcript), [transcript])
  const phrase = useMemo(() => phrases.find((item) => time >= item.start && time < item.end + 0.15) ?? null, [phrases, time])
  const cue = phrase
  const words = phrase?.words ?? []

  const base: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    bottom: "14%",
    transform: "translateX(-50%)",
    maxWidth: "86%",
    textAlign: "center",
    lineHeight: 1.25,
    pointerEvents: "none",
  }
  const look: React.CSSProperties =
    style === "bold"
      ? {
          fontSize: "4.4cqw",
          fontWeight: 900,
          color: "#fde047",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          WebkitTextStroke: "0.22cqw #000",
          paintOrder: "stroke fill",
          textShadow: "0 0.3cqw 0.8cqw rgb(0 0 0 / .5)",
        }
      : {
          fontSize: "3cqw",
          fontWeight: 600,
          color: "#fff",
          background: "rgb(0 0 0 / .62)",
          padding: "0.5cqw 1.4cqw",
          borderRadius: "1cqw",
        }

  return (
    <div className="absolute inset-0 z-10 overflow-hidden" style={{ containerType: "size", pointerEvents: "none" }}>
      <button
        type="button"
        aria-pressed={on}
        title={on ? "Hide captions" : "Show captions"}
        onClick={() => setOn((value) => !value)}
        style={{ position: "absolute", top: 8, right: 8, pointerEvents: "auto", opacity: on ? 0.85 : 0.55 }}
        className="rounded-md bg-black/60 px-2 py-1 text-[11px] font-bold text-white backdrop-blur hover:opacity-100"
      >
        CC
      </button>
      {on && !nativeCaption && cue && (
        <div style={{ ...base, ...look }}>
          {style === "karaoke" && words.length > 0
            ? words.map((word, index) => {
                const spoken = time >= word.start
                const now = spoken && time < word.end
                return (
                  <span
                    key={`${word.start}-${index}`}
                    style={{
                      color: now ? "#fde047" : spoken ? "#fff" : "rgb(255 255 255 / .55)",
                      transition: "color .08s",
                    }}
                  >
                    {word.text}{" "}
                  </span>
                )
              })
            : cue.text}
        </div>
      )}
    </div>
  )
}
