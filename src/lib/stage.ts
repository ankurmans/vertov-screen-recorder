/**
 * How a recording is composed at playback. Screen and camera are separate
 * tracks, so the owner can change all of this after recording.
 */

import { parseZooms } from "@/lib/zooms"
import type { ZoomPoint } from "@/lib/zooms"
import { parseCursor } from "@/lib/cursor"
import type { CursorSettings } from "@/lib/cursor"

/** `side` is a camera card beside the screen; `split` runs the camera the full height of one edge. */
export type StageLayout = "bubble" | "side" | "split" | "screen" | "camera"
export type BubbleCorner = "tl" | "tr" | "bl" | "br"
export type BubbleSize = "s" | "m" | "l"
/** `portrait` is a 3:4 card, taller than wide. */
export type BubbleShape = "circle" | "rounded" | "portrait"
export type CameraSide = "left" | "right"

export interface StageStyle {
  layout: StageLayout
  corner: BubbleCorner
  size: BubbleSize
  shape: BubbleShape
  /** Bubble center in percent of the stage, set by dragging; without it the bubble sits in `corner`. */
  x?: number
  y?: number
  /** Bubble width as a fraction of the stage width; without it `size` picks one. */
  scale?: number
  /** Which edge the camera takes in the side and split layouts. */
  side?: CameraSide
  /** Camera panel width in the split layout, as a fraction of the stage width. */
  split?: number
  denoise?: boolean
  zooms?: ZoomPoint[]
  /** Pointer drawn over the recording from the extension's saved mouse path. */
  cursor?: CursorSettings
  /** Key into BACKGROUNDS; "none" plays the screen edge to edge. */
  background: string
  /** Other workspace videos joined before and after this one in MP4 downloads (reusable intro/outro). */
  intro?: string
  outro?: string
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

const LAYOUTS: ReadonlyArray<StageLayout> = ["bubble", "side", "split", "screen", "camera"]
const CORNERS: ReadonlyArray<BubbleCorner> = ["tl", "tr", "bl", "br"]
const SIZES: ReadonlyArray<BubbleSize> = ["s", "m", "l"]
const SHAPES: ReadonlyArray<BubbleShape> = ["circle", "rounded", "portrait"]

export const SCALE_RANGE = { min: 0.08, max: 0.45 }
export const SPLIT_RANGE = { min: 0.25, max: 0.5, default: 0.36 }

const number = (input: unknown, min: number, max: number) =>
  typeof input === "number" && Number.isFinite(input) ? Math.min(max, Math.max(min, Math.round(input * 1000) / 1000)) : undefined

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
  const zooms = parseZooms(input.zooms)
  const cursor = parseCursor(input.cursor)
  const clip = (value: unknown) => (typeof value === "string" && /^[a-f0-9]{8}$/.test(value) ? value : undefined)
  const intro = clip(input.intro)
  const outro = clip(input.outro)
  const x = number(input.x, 0, 100)
  const y = number(input.y, 0, 100)
  const scale = number(input.scale, SCALE_RANGE.min, SCALE_RANGE.max)
  const split = number(input.split, SPLIT_RANGE.min, SPLIT_RANGE.max)
  return {
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(split !== undefined ? { split } : {}),
    ...(input.side === "left" ? { side: "left" as const } : {}),
    ...(zooms.length ? { zooms } : {}),
    ...(cursor ? { cursor } : {}),
    ...(intro ? { intro } : {}),
    ...(outro ? { outro } : {}),
    denoise: input.denoise === true,
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

/** Bubble width as a fraction of the stage width, for each preset size. */
export const BUBBLE_SIZES: Record<BubbleSize, number> = { s: 0.14, m: 0.2, l: 0.28 }

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Where the screen and camera sit, in percent of the stage. `aspect` is the
 * screen recording's width / height; the stage keeps that aspect unless the
 * side-by-side or split layout needs a 16:9 canvas.
 */
export function stageGeometry(
  style: StageStyle,
  aspect: number,
  hasCamera: boolean,
): { stageAspect: number; screen: Box | null; camera: Box | null } {
  const framed = style.background !== "none"
  const layout = hasCamera ? style.layout : "screen"
  const left = style.side === "left"

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
      screen: { left: left ? pad * 2 + cameraWidth : pad, top: (100 - screenHeight) / 2, width: screenWidth, height: screenHeight },
      camera: {
        left: left ? pad : pad * 2 + screenWidth,
        top: (100 - cameraHeight) / 2,
        width: cameraWidth,
        height: cameraHeight,
      },
    }
  }

  if (layout === "split") {
    // The camera fills one edge top to bottom; the screen is fitted, centered, in the rest.
    const stageAspect = 16 / 9
    const cameraWidth = (style.split ?? SPLIT_RANGE.default) * 100
    const padX = 3
    const padY = padX * stageAspect
    let screenWidth = 100 - cameraWidth - padX * 2
    let screenHeight = (screenWidth / aspect) * stageAspect
    if (screenHeight > 100 - padY * 2) {
      screenHeight = 100 - padY * 2
      screenWidth = (screenHeight * aspect) / stageAspect
    }
    const areaLeft = left ? cameraWidth : 0
    return {
      stageAspect,
      screen: {
        left: areaLeft + (100 - cameraWidth - screenWidth) / 2,
        top: (100 - screenHeight) / 2,
        width: screenWidth,
        height: screenHeight,
      },
      camera: { left: left ? 0 : 100 - cameraWidth, top: 0, width: cameraWidth, height: 100 },
    }
  }

  const inset = framed ? 6 : 0
  const screen = { left: inset, top: inset, width: 100 - inset * 2, height: 100 - inset * 2 }
  if (layout === "screen" || !hasCamera) return { stageAspect: aspect, screen, camera: null }
  return { stageAspect: aspect, screen, camera: bubbleBox(style, aspect) }
}

/** The bubble's box: dragged position and size when set, otherwise its corner and preset size. */
export function bubbleBox(style: StageStyle, aspect: number): Box {
  const tall = style.shape === "portrait" ? 4 / 3 : 1
  const margin = 2.5
  let width = (style.scale ?? BUBBLE_SIZES[style.size]) * 100
  // Width is in percent of the stage width, height in percent of its height.
  let height = width * aspect * tall
  if (height > 100 - margin * 2) {
    height = 100 - margin * 2
    width = height / (aspect * tall)
  }
  if (style.x !== undefined && style.y !== undefined) {
    return {
      left: clamp(style.x - width / 2, 0, 100 - width),
      top: clamp(style.y - height / 2, 0, 100 - height),
      width,
      height,
    }
  }
  return {
    left: style.corner.endsWith("l") ? margin : 100 - margin - width,
    top: style.corner.startsWith("t") ? margin * aspect : 100 - margin * aspect - height,
    width,
    height,
  }
}
