import { useEffect, useRef } from "react"
import type { Cut } from "@/lib/cuts"
import { cutAt } from "@/lib/cuts"

/**
 * Jumps playback over removed stretches. Checked every frame, since
 * timeupdate's ~250ms cadence would let a short cut like one "um" play.
 */
export function useSkipCuts(element: HTMLVideoElement | null, cuts: Array<Cut>) {
  const cutsRef = useRef(cuts)
  cutsRef.current = cuts

  useEffect(() => {
    if (!element) return
    let handle = 0
    const loop = () => {
      const cut = cutAt(cutsRef.current, element.currentTime)
      if (cut && !element.paused) element.currentTime = cut[1]
      handle =
        "requestVideoFrameCallback" in element
          ? element.requestVideoFrameCallback(loop)
          : requestAnimationFrame(loop)
    }
    loop()
    return () => {
      if ("cancelVideoFrameCallback" in element) element.cancelVideoFrameCallback(handle)
      cancelAnimationFrame(handle)
    }
  }, [element])
}
