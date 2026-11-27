import { Suspense, lazy } from "react"
import type { ComponentProps } from "react"

// Video.js builds AbortControllers when its module loads, which Workers forbid
// outside a request handler. Loading it lazily keeps it out of the server
// render, so share pages render on the server (the player is client-only anyway).
const Player = lazy(() => import("@/components/video-player").then((module) => ({ default: module.VideoPlayer })))

export function VideoPlayer(props: ComponentProps<typeof Player>) {
  return (
    <Suspense
      fallback={
        <div className="w-full bg-black" style={{ aspectRatio: String(props.stageAspect ?? 16 / 9), background: props.stageBackground }} />
      }
    >
      <Player {...props} />
    </Suspense>
  )
}
