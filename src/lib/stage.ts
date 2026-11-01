/**
 * How a recording is composed at playback. Screen and camera are separate
 * tracks, so the owner can change all of this after recording.
 */

export type StageLayout = "bubble" | "side" | "screen" | "camera"
export type BubbleCorner = "tl" | "tr" | "bl" | "br"
export type BubbleSize = "s" | "m" | "l"
export type BubbleShape = "circle" | "rounded"

export interface StageStyle {
  layout: StageLayout
  corner: BubbleCorner
  size: BubbleSize
  shape: BubbleShape
  /** Key into BACKGROUNDS; "none" plays the screen edge to edge. */
  background: string
}

export const DEFAULT_STYLE: StageStyle = {
  layout: "bubble",
  corner: "bl",
  size: "m",
  shape: "circle",
  background: "none",
}

/** `colors` drive the exported MP4's gradient; `css` the player. */
export const BACKGROUNDS: Record<string, { label: string; css: string; colors: Array<string> }> = {
  none: { label: "None", css: "#000", colors: ["#000000"] },
  dusk: { label: "Dusk", css: "linear-gradient(135deg,#4f46e5 0%,#9333ea 50%,#ec4899 100%)", colors: ["#4f46e5", "#9333ea", "#ec4899"] },
  ocean: { label: "Ocean", css: "linear-gradient(135deg,#0ea5e9 0%,#2563eb 55%,#1e1b4b 100%)", colors: ["#0ea5e9", "#2563eb", "#1e1b4b"] },
  mint: { label: "Mint", css: "linear-gradient(135deg,#a7f3d0 0%,#34d399 45%,#0f766e 100%)", colors: ["#a7f3d0", "#34d399", "#0f766e"] },
  peach: { label: "Peach", css: "linear-gradient(135deg,#fde68a 0%,#fb923c 50%,#e11d48 100%)", colors: ["#fde68a", "#fb923c", "#e11d48"] },
  graphite: { label: "Graphite", css: "radial-gradient(120% 120% at 20% 10%,#525252 0%,#171717 60%,#000 100%)", colors: ["#525252", "#171717", "#000000"] },
  paper: { label: "Paper", css: "linear-gradient(180deg,#fafaf9 0%,#e7e5e4 100%)", colors: ["#fafaf9", "#e7e5e4"] },
}

const LAYOUTS: ReadonlyArray<StageLayout> = ["bubble", "side", "screen", "camera"]
const CORNERS: ReadonlyArray<BubbleCorner> = ["tl", "tr", "bl", "br"]
const SIZES: ReadonlyArray<BubbleSize> = ["s", "m", "l"]
const SHAPES: ReadonlyArray<BubbleShape> = ["circle", "rounded"]

function pick<T extends string>(value: unknown, options: ReadonlyArray<T>, fallback: T): T {
  return typeof value === "string" && (options as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback
}

export function parseStyle(raw: unknown): StageStyle {
  let value: unknown = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
  }
  const input = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>
  return {
    layout: pick(input.layout, LAYOUTS, DEFAULT_STYLE.layout),
    corner: pick(input.corner, CORNERS, DEFAULT_STYLE.corner),
    size: pick(input.size, SIZES, DEFAULT_STYLE.size),
    shape: pick(input.shape, SHAPES, DEFAULT_STYLE.shape),
    background:
      typeof input.background === "string" && input.background in BACKGROUNDS
        ? input.background
        : DEFAULT_STYLE.background,
  }
}

/** Bubble diameter as a fraction of the stage width. */
export const BUBBLE_SIZES: Record<BubbleSize, number> = { s: 0.14, m: 0.2, l: 0.28 }

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the screen and camera sit, in percent of the stage. `aspect` is the
 * screen recording's width / height; the stage keeps that aspect unless the
 * side-by-side layout needs a wider canvas.
 */
export function stageGeometry(
  style: StageStyle,
  aspect: number,
  hasCamera: boolean,
): { stageAspect: number; screen: Box | null; camera: Box | null } {
  const framed = style.background !== "none"
  const layout = hasCamera ? style.layout : "screen"

  if (layout === "camera") {
    return { stageAspect: aspect, screen: null, camera: { left: 0, top: 0, width: 100, height: 100 } }
  }

  if (layout === "side") {
    const stageAspect = 16 / 9
    // Screen gets ~66% of the width, the camera a 3:4 card beside it.
    const pad = 4
    let screenWidth = 66
    let screenHeight = ((screenWidth / aspect) * stageAspect)
    if (screenHeight > 100 - pad * 2) {
      screenHeight = 100 - pad * 2
      screenWidth = (screenHeight * aspect) / stageAspect
    }
    const cameraWidth = 100 - pad * 3 - screenWidth
    const cameraHeight = Math.min(100 - pad * 2, ((cameraWidth / 0.75) * stageAspect) / 1)
    return {
      stageAspect,
      screen: { left: pad, top: (100 - screenHeight) / 2, width: screenWidth, height: screenHeight },
      camera: {
        left: pad * 2 + screenWidth,
        top: (100 - cameraHeight) / 2,
        width: cameraWidth,
        height: cameraHeight,
      },
    }
  }

  const inset = framed ? 6 : 0
  const screen = { left: inset, top: inset, width: 100 - inset * 2, height: 100 - inset * 2 }
  if (layout === "screen" || !hasCamera) return { stageAspect: aspect, screen, camera: null }

  const diameter = BUBBLE_SIZES[style.size] * 100
  const diameterY = diameter * aspect
  const margin = 2.5
  const left = style.corner.endsWith("l") ? margin : 100 - margin - diameter
  const top = style.corner.startsWith("t") ? margin * aspect : 100 - margin * aspect - diameterY
  return {
    stageAspect: aspect,
    screen,
    camera: { left, top, width: diameter, height: diameterY },
  }
}
