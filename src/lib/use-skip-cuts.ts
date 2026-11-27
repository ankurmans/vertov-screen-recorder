import { useEffect, useRef } from "react"
import type { Cut } from "@/lib/cuts"
import { cutAt } from "@/lib/cuts"

/**
 * Jumps playback over removed stretches. Checked every frame, since
 * timeupdate's ~250ms cadence would let a short cut like one "um" play.
 * Every display frame, not only every video frame: a still page gets few
 * video frames, so a cut through one would play on until the picture changed.
 */
export function useSkipCuts(element: HTMLVideoElement | null, cuts: Array<Cut>) {
  const cutsRef = useRef(cuts)
  cutsRef.current = cuts

  useEffect(() => {
    if (!element) return
    let handle = 0
    let frame = 0
    const skip = () => {
      const cut = cutAt(cutsRef.current, element.currentTime)
      if (cut && !element.paused) element.currentTime = cut[1]
    }
    const loop = () => {
      skip()
      handle = element.requestVideoFrameCallback(loop)
    }
    const tick = () => {
      skip()
      frame = requestAnimationFrame(tick)
    }
    if ("requestVideoFrameCallback" in element) loop()
    tick()
    return () => {
      if ("cancelVideoFrameCallback" in element) element.cancelVideoFrameCallback(handle)
      cancelAnimationFrame(frame)
    }
  }, [element])
}
