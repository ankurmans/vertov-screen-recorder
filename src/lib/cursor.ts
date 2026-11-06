/**
 * Cursor styles: what the pointer looks like in a finished video, drawn over the recording from the mouse path the Chrome
 * extension saved. Shared by the player, the studio panel and the export so all three agree.
 */

export const CURSOR_STYLES = ["arrow", "classic", "point", "tilt", "open", "eye", "dot"] as const
export type CursorStyle = (typeof CURSOR_STYLES)[number]
export const CURSOR_FX = ["none", "ring", "pulse"] as const
export type CursorFx = (typeof CURSOR_FX)[number]
/** Cursor height in output pixels at 1080p: small, normal, large, huge. */
export const CURSOR_SIZES = [30, 42, 60, 84] as const

export interface CursorSettings {
  style: CursorStyle
  size: 0 | 1 | 2 | 3
  fx: CursorFx
  smooth: boolean
  spot: boolean
  /** Hide the pointer after it has sat still for a couple of seconds. */
  idle: boolean
}

export const DEFAULT_CURSOR: CursorSettings = { style: "eye", size: 1, fx: "ring", smooth: true, spot: false, idle: true }

export function parseCursor(raw: unknown): CursorSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const input = raw as Record<string, unknown>
  const style = CURSOR_STYLES.find((candidate) => candidate === input.style)
  if (!style) return undefined
  const size = typeof input.size === "number" && [0, 1, 2, 3].includes(input.size) ? (input.size as 0 | 1 | 2 | 3) : DEFAULT_CURSOR.size
  return {
    style,
    size,
    fx: CURSOR_FX.find((candidate) => candidate === input.fx) ?? DEFAULT_CURSOR.fx,
    smooth: input.smooth !== false,
    spot: input.spot === true,
    idle: input.idle !== false,
  }
}

/** One 128-unit drawing per pose; `hot` is where the pointer is inside it. The Kino-Eye's shutter blades close to a pinhole on a click. */
export const CURSOR_ART: Record<CursorStyle, { label: string; hot: [number, number]; idle: string; press?: string }> = {
  arrow: { label: "Arrow", hot: [6, 4], idle: '<path d="M6 4 L6 98 L30 76 L46 114 L62 107 L46 70 L82 70 Z" fill="#fff" stroke="#111" stroke-width="7" stroke-linejoin="round"/>' },
  classic: {
    label: "Classic hand",
    hot: [54, 22],
    idle: '<g fill="#fff" stroke="#111" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M45 26C45 17 60 17 60 26L60 52C60 46 72 46 72 53C72 48 84 48 84 56C84 53 96 54 96 62L96 88C96 106 86 120 66 120L58 120C46 120 40 114 34 104L18 80C14 72 24 66 30 72L42 86Z"/><path d="M60 52L60 76M72 53L72 76M84 56L84 76" fill="none" stroke-width="4.5"/></g>',
  },
  point: { label: "Glove point", hot: [56, 8], idle: '<g fill="#fff" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d=\"M51 100C46 105 48 112 56 117C67 124 88 124 99 117C106 112 104 106 99 102Z\"/><path d=\"M49 101C40 94 31 80 24 78C14 76 7 73 7 67C7 62 12 57 19 57C27 57 36 63 45 69C49 60 47 43 46 31C44 19 47 11 54 7C60 4 67 7 67 15L66 44C77 42 87 46 92 55C104 56 112 64 115 76C119 89 113 101 102 108C90 116 63 114 49 101Z\"/><path d=\"M66 44C65 58 67 69 73 77C69 62 71 54 66 44ZM92 55C94 65 96 72 102 79C99 67 100 62 92 55Z\" fill=\"#111\" stroke=\"none\"/><path d=\"M67 88C68 95 67 100 67 103M82 82C81 91 80 98 78 104M96 89C94 96 92 101 90 104\" fill=\"none\" stroke-width=\"4.4\"/></g>' },
  tilt: {
    label: "Glove tilt",
    hot: [38, 18],
    idle: '<g fill="#fff" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" transform="translate(64 64) rotate(-24) scale(.88) translate(-64 -64)"><path d=\"M51 100C46 105 48 112 56 117C67 124 88 124 99 117C106 112 104 106 99 102Z\"/><path d=\"M49 101C40 94 31 80 24 78C14 76 7 73 7 67C7 62 12 57 19 57C27 57 36 63 45 69C49 60 47 43 46 31C44 19 47 11 54 7C60 4 67 7 67 15L66 44C77 42 87 46 92 55C104 56 112 64 115 76C119 89 113 101 102 108C90 116 63 114 49 101Z\"/><path d=\"M66 44C65 58 67 69 73 77C69 62 71 54 66 44ZM92 55C94 65 96 72 102 79C99 67 100 62 92 55Z\" fill=\"#111\" stroke=\"none\"/><path d=\"M67 88C68 95 67 100 67 103M82 82C81 91 80 98 78 104M96 89C94 96 92 101 90 104\" fill=\"none\" stroke-width=\"4.4\"/></g>',
  },
  open: {
    label: "Open hand",
    hot: [64, 64],
    idle: '<g fill="#fff" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M45 101C40 106 43 114 51 118C62 124 85 123 94 117C101 112 99 105 94 101Z"/><path d="M45 104C37 97 33 89 28 81L13 61C9 55 10 49 15 46C20 43 24 46 28 51L39 64L29 29C27 22 29 17 35 16C41 15 44 19 46 26L52 49L50 16C50 9 53 5 59 5C65 5 68 9 68 16L69 47L75 21C76 15 80 12 85 14C91 15 92 20 91 26L86 53L96 35C99 30 104 29 108 32C112 35 113 39 110 45L101 67C101 83 99 95 91 103C81 113 56 113 45 104Z"/><path d="M40 65C50 64 56 70 57 80M53 90L55 101M69 87L68 102M83 88L80 102" fill="none" stroke-width="4.4"/></g>',
    press: '<g fill="#fff" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M44 100C39 106 43 114 51 118C63 124 87 123 96 116C102 111 100 104 95 100Z"/><path d="M43 103C32 96 27 87 25 76L23 63C22 56 26 51 32 51C37 51 41 55 44 60L42 51C41 44 44 39 50 39C56 39 60 43 61 49L62 43C63 37 67 34 73 35C79 36 81 40 81 47C85 41 90 40 95 43C100 45 102 50 101 56C108 51 115 56 114 64L110 82C108 94 103 101 94 106C79 114 55 112 43 103Z"/><path d="M33 66C43 61 56 64 61 70C66 76 62 83 55 82L43 79M61 49L63 59M81 47L81 59M101 56L98 66M61 92L62 101M77 90L76 101M92 88L88 100" fill="none" stroke-width="4.4"/></g>',
  },
  eye: {
    label: "Kino-Eye",
    hot: [64, 64],
    idle: '<g transform="translate(64 64) scale(.4)"><circle r="97" fill="#ecebe7" stroke="#111" stroke-width="8"/><circle r="58" fill="#0a0b0d"/><circle r="58" fill="none" stroke="#d92b14" stroke-width="6"/><g stroke="#3c3f45" stroke-width="1.6"><line x1=\"20.3\" y1=\"8.4\" x2=\"20.3\" y2=\"54.3\"/><line x1=\"8.4\" y1=\"20.3\" x2=\"-24.0\" y2=\"52.8\"/><line x1=\"-8.4\" y1=\"20.3\" x2=\"-54.3\" y2=\"20.3\"/><line x1=\"-20.3\" y1=\"8.4\" x2=\"-52.8\" y2=\"-24.0\"/><line x1=\"-20.3\" y1=\"-8.4\" x2=\"-20.3\" y2=\"-54.3\"/><line x1=\"-8.4\" y1=\"-20.3\" x2=\"24.0\" y2=\"-52.8\"/><line x1=\"8.4\" y1=\"-20.3\" x2=\"54.3\" y2=\"-20.3\"/><line x1=\"20.3\" y1=\"-8.4\" x2=\"52.8\" y2=\"24.0\"/></g><polygon points="20.3,8.4 8.4,20.3 -8.4,20.3 -20.3,8.4 -20.3,-8.4 -8.4,-20.3 8.4,-20.3 20.3,-8.4" fill="#000"/><circle cx="-9" cy="-10" r="5" fill="#fff" opacity=".92"/></g>',
    press: '<g transform="translate(64 64) scale(.4)"><circle r="97" fill="#ecebe7" stroke="#111" stroke-width="8"/><circle r="58" fill="#5b6068"/><circle r="58" fill="none" stroke="#d92b14" stroke-width="6"/><g stroke="#1a1c20" stroke-width="2.4"><line x1="6.5" y1="2.7" x2="6.5" y2="57.6"/><line x1="2.7" y1="6.5" x2="-36.2" y2="45.3"/><line x1="-2.7" y1="6.5" x2="-57.6" y2="6.5"/><line x1="-6.5" y1="2.7" x2="-45.3" y2="-36.2"/><line x1="-6.5" y1="-2.7" x2="-6.5" y2="-57.6"/><line x1="-2.7" y1="-6.5" x2="36.2" y2="-45.3"/><line x1="2.7" y1="-6.5" x2="57.6" y2="-6.5"/><line x1="6.5" y1="-2.7" x2="45.3" y2="36.2"/></g><polygon points="6.5,2.7 2.7,6.5 -2.7,6.5 -6.5,2.7 -6.5,-2.7 -2.7,-6.5 2.7,-6.5 6.5,-2.7" fill="#000"/></g>',
  },
  dot: { label: "Dot", hot: [64, 64], idle: '<circle cx="64" cy="64" r="30" fill="rgba(220,38,38,.28)"/><circle cx="64" cy="64" r="13" fill="#dc2626" stroke="#fff" stroke-width="6"/>' },
}

/** A mouse path in the recorded picture's own fractions (0 to 1), plus where the clicks were. */
export interface CursorTrack {
  points: Array<[number, number, number]>
  clicks: Array<[number, number, number]>
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Where the pointer is at time `t`. Smoothing blends the raw samples over a short window so jitter disappears. */
export function cursorAt(track: CursorTrack, t: number, smooth: boolean): { x: number; y: number } | null {
  const points = track.points
  if (points.length < 2 || t < points[0][0] - 0.5) return null
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (points[mid][0] <= t) low = mid
    else high = mid - 1
  }
  const a = points[low]
  const b = points[Math.min(low + 1, points.length - 1)]
  const span = b[0] - a[0]
  const along = span > 0 ? Math.min(1, Math.max(0, (t - a[0]) / span)) : 0
  let x = a[1] + (b[1] - a[1]) * along
  let y = a[2] + (b[2] - a[2]) * along
  if (smooth) {
    // Average the samples within a quarter second around t, weighted toward the centre.
    let sx = 0
    let sy = 0
    let weight = 0
    for (let i = low; i >= 0 && t - points[i][0] <= 0.12; i--) {
      const w = 1 - (t - points[i][0]) / 0.14
      sx += points[i][1] * w
      sy += points[i][2] * w
      weight += w
    }
    for (let i = low + 1; i < points.length && points[i][0] - t <= 0.12; i++) {
      const w = 1 - (points[i][0] - t) / 0.14
      sx += points[i][1] * w
      sy += points[i][2] * w
      weight += w
    }
    if (weight > 0) {
      x = sx / weight
      y = sy / weight
    }
  }
  return { x: clamp01(x), y: clamp01(y) }
}

/** How far through a click's animation it is at `t` (0 to 1), or null when no click is active. */
export function clickProgress(track: CursorTrack, t: number, duration = 0.5): { x: number; y: number; p: number } | null {
  for (let i = track.clicks.length - 1; i >= 0; i--) {
    const [at, x, y] = track.clicks[i]
    if (at <= t) return t - at < duration ? { x, y, p: (t - at) / duration } : null
  }
  return null
}

/** Cursor height in pixels on a stage `width` pixels wide; the same rule drives the player and the exported MP4. */
export const cursorPx = (size: number, width: number) => CURSOR_SIZES[size] * Math.max(0.55, width / 1000)

/** True when the pointer has not moved and nothing was clicked for `after` seconds. */
export function cursorIdle(track: CursorTrack, t: number, after = 2.5): boolean {
  const here = cursorAt(track, t, false)
  const before = cursorAt(track, t - after, false)
  if (!here || !before) return false
  if (Math.hypot(here.x - before.x, here.y - before.y) > 0.004) return false
  return !track.clicks.some(([at]) => at > t - after && at <= t)
}
