import { useEffect, useRef } from "react"

// Aperture blades: each line leaves a corner of the octagonal pupil along the edge before it, out to the iris rim.
const IRIS = 58
const PUPIL = 22
const corners = Array.from({ length: 8 }, (_, i) => {
  const angle = (i * Math.PI) / 4 + Math.PI / 8
  return [PUPIL * Math.cos(angle), PUPIL * Math.sin(angle)] as const
})
const blades = corners.map(([x, y], i) => {
  const [px, py] = corners[(i + 7) % 8]
  const length = Math.hypot(x - px, y - py)
  const dx = (x - px) / length
  const dy = (y - py) / length
  const b = x * dx + y * dy
  const t = -b + Math.sqrt(b * b - (x * x + y * y - IRIS * IRIS))
  return { x1: x, y1: y, x2: x + dx * t, y2: y + dy * t }
})
const octagon = corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")

const pointer = { x: 0, y: 0, at: -1e9 }
let listening = false
function listen() {
  if (listening || typeof window === "undefined") return
  listening = true
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX
    pointer.y = event.clientY
    pointer.at = performance.now()
  })
}

/**
 * The Vertov eye. The iris follows the pointer, drifts when it is still, and blinks now and then.
 * "screen" sits on a dark surface; "paper" sits on the page, so its rim takes the text colour.
 */
export function Eye({ size, tone = "screen", className = "" }: { size: number | string; tone?: "screen" | "paper"; className?: string }) {
  const root = useRef<HTMLSpanElement>(null)
  const iris = useRef<SVGGElement>(null)

  useEffect(() => {
    listen()
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let x = 0
    let y = 0
    let frame = 0
    const phase = Math.random() * 10
    const tick = (now: number) => {
      const el = root.current
      if (el && iris.current) {
        const rect = el.getBoundingClientRect()
        if (rect.bottom > 0 && rect.top < innerHeight) {
          let tx = 0
          let ty = 0
          if (!calm) {
            if (now - pointer.at < 3500) {
              const dx = pointer.x - (rect.left + rect.width / 2)
              const dy = pointer.y - (rect.top + rect.height / 2)
              const d = Math.hypot(dx, dy) || 1
              const m = Math.min(d / 260, 1) * 24
              tx = (dx / d) * m
              ty = (dy / d) * m
            } else {
              tx = Math.sin(now / 1900 + phase) * 15
              ty = Math.cos(now / 2600 + phase * 2) * 9
            }
          }
          x += (tx - x) * 0.14
          y += (ty - y) * 0.14
          iris.current.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    let blinkTimer = 0
    let openTimer = 0
    const blink = () => {
      root.current?.classList.add("is-blinking")
      openTimer = window.setTimeout(() => root.current?.classList.remove("is-blinking"), 130)
      blinkTimer = window.setTimeout(blink, 3800 + Math.random() * 3200)
    }
    if (!calm) blinkTimer = window.setTimeout(blink, 1500 + Math.random() * 2000)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(blinkTimer)
      clearTimeout(openTimer)
    }
  }, [])

  const rim = tone === "paper" ? "currentColor" : "#ECEBE7"
  const sclera = tone === "paper" ? "var(--color-zinc-50)" : "#ECEBE7"
  return (
    <span ref={root} className={`kino-eye inline-block shrink-0 ${className}`} style={{ width: size, height: size }} role="img" aria-label={`${"Vertov"} eye`}>
      <svg viewBox="-100 -100 200 200" className="block size-full overflow-visible">
        <g className="kino-eye-ball">
          <circle r="97" fill="none" stroke={rim} strokeWidth="2" />
          <circle r="90" fill={sclera} />
          <g ref={iris}>
            <circle r={IRIS} fill="#0A0B0D" />
            <circle r={IRIS} fill="none" stroke="#D92B14" strokeWidth="4" />
            <g stroke="#3C3F45" strokeWidth="1.3">
              {blades.map((b, i) => (
                <line key={i} x1={b.x1.toFixed(1)} y1={b.y1.toFixed(1)} x2={b.x2.toFixed(1)} y2={b.y2.toFixed(1)} />
              ))}
            </g>
            <polygon points={octagon} fill="#000" />
            <circle cx="-9" cy="-10" r="4.5" fill="#fff" opacity=".92" />
          </g>
        </g>
      </svg>
    </span>
  )
}
