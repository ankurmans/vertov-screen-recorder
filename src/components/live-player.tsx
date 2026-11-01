import { useEffect, useRef, useState } from "react"

const POLL_MS = 2000

/**
 * Watch a recording while it's still going. The recorder sends a live copy a few seconds at a time;
 * this appends those chunks to the video as they arrive, so viewers can rewind to the start or jump
 * back to the live edge. When recording ends the page reloads into the normal player.
 */
export function LivePlayer({ id }: { id: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<"waiting" | "live" | "unsupported">("waiting")
  const [behind, setBehind] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    let source: MediaSource | null = null
    let buffer: SourceBuffer | null = null
    let appended = 0
    const queue: Array<ArrayBuffer> = []

    const pump = () => {
      if (!buffer || buffer.updating || queue.length === 0 || source?.readyState !== "open") return
      try {
        buffer.appendBuffer(queue.shift()!)
      } catch {
        // Quota or a bad chunk: keep what's playing rather than stopping the page.
      }
    }

    async function attach(mime: string): Promise<boolean> {
      if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(mime)) {
        setPhase("unsupported")
        return false
      }
      source = new MediaSource()
      video!.src = URL.createObjectURL(source)
      await new Promise<void>((resolve) => source!.addEventListener("sourceopen", () => resolve(), { once: true }))
      buffer = source.addSourceBuffer(mime)
      buffer.addEventListener("updateend", pump)
      return true
    }

    async function run() {
      let first = true
      while (!cancelled) {
        try {
          const manifest = (await (await fetch(`/api/live/${id}`)).json()) as { status: string; count: number; mime: string | null }
          if (manifest.status !== "recording") {
            window.location.reload()
            return
          }
          if (manifest.count > 0 && manifest.mime && (buffer || (await attach(manifest.mime)))) {
            const catchUp = manifest.count - appended
            while (appended < manifest.count && !cancelled) {
              const response = await fetch(`/api/live/${id}/${appended + 1}`)
              if (!response.ok) break
              queue.push(await response.arrayBuffer())
              appended += 1
              pump()
            }
            if (first && appended > 0) {
              first = false
              setPhase("live")
              // A late viewer lands at the live edge; "Watch from start" is one click away.
              if (catchUp > 2) setTimeout(() => goLive(), 600)
              void video!.play().catch(() => {})
            }
          } else if (phase === "unsupported") {
            return
          }
        } catch {
          // A missed poll just means the next one catches up.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
    }

    const edge = () => (video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0)
    function goLive() {
      if (edge() > 0) video!.currentTime = Math.max(0, edge() - 1)
    }
    const timer = setInterval(() => setBehind(Math.max(0, edge() - video.currentTime)), 500)
    ;(video as HTMLVideoElement & { goLive?: () => void }).goLive = goLive
    void run()
    return () => {
      cancelled = true
      clearInterval(timer)
      if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src)
    }
  }, [id])

  const live = (action: "start" | "live") => {
    const video = videoRef.current
    if (!video) return
    if (action === "start") video.currentTime = 0
    else (video as HTMLVideoElement & { goLive?: () => void }).goLive?.()
    void video.play().catch(() => {})
  }

  return (
    <div className="relative aspect-video w-full bg-neutral-900">
      <video ref={videoRef} controls autoPlay muted playsInline className={`size-full bg-black ${phase === "live" ? "" : "invisible"}`} />
      {phase !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-neutral-300">
          <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
          {phase === "unsupported" ? "Live viewing isn't supported in this browser. This page updates when the recording is done." : "Recording in progress. Live view starts in a few seconds."}
        </div>
      )}
      {phase === "live" && (
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE
          </span>
          <button type="button" onClick={() => live("start")} className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur hover:bg-black/80">
            Watch from start
          </button>
          {behind > 4 && (
            <button type="button" onClick={() => live("live")} className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur hover:bg-black/80">
              Jump to live
            </button>
          )}
        </div>
      )}
    </div>
  )
}
