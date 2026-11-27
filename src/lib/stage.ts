/**
 * How a recording is composed at playback. Screen and camera are separate
 * tracks, so the owner can change all of this after recording.
 */

import { parseZooms } from "@/lib/zooms"
import type { ZoomPoint } from "@/lib/zooms"

/** `side` is a camera card beside the screen; `split` runs the camera the full height of one edge; `focus` fills the video with the camera and floats the screen in a corner. */
export type StageLayout = "bubble" | "side" | "split" | "screen" | "camera" | "focus"
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
  zooms?: ZoomPoint[]
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

export interface Background {
  label: string
  /** The player's CSS background. */
  css: string
  /** Gradient stops for the exported MP4; for a wallpaper, the colours it fades from if the image is missing. */
  colors: Array<string>
  /** A wallpaper's file in public/backgrounds (and exporter/backgrounds, which scripts/make-backgrounds.py keeps in step). */
  image?: string
}

const gradient = (label: string, colors: Array<string>): Background => ({
  label,
  css: `linear-gradient(135deg,${colors.map((color, index) => `${color} ${Math.round((index / (colors.length - 1)) * 100)}%`).join(",")})`,
  colors,
})

const wallpaper = (label: string, image: string, colors: Array<string>): Background => ({
  label,
  css: `url(/backgrounds/${image}) center / cover no-repeat, ${colors[0]}`,
  colors,
  image,
})

/** Gradients first, then wallpapers; the studio panel lists them in this order. */
export const BACKGROUNDS: Record<string, Background> = {
  none: { label: "None", css: "#000", colors: ["#000000"] },
  dusk: gradient("Dusk", ["#4f46e5", "#9333ea", "#ec4899"]),
  ocean: gradient("Ocean", ["#0ea5e9", "#2563eb", "#1e1b4b"]),
  mint: gradient("Mint", ["#a7f3d0", "#34d399", "#0f766e"]),
  peach: gradient("Peach", ["#fde68a", "#fb923c", "#e11d48"]),
  graphite: { label: "Graphite", css: "radial-gradient(120% 120% at 20% 10%,#525252 0%,#171717 60%,#000 100%)", colors: ["#525252", "#171717", "#000000"] },
  paper: { label: "Paper", css: "linear-gradient(180deg,#fafaf9 0%,#e7e5e4 100%)", colors: ["#fafaf9", "#e7e5e4"] },
  sunset: gradient("Sunset", ["#f97316", "#db2777", "#7c3aed"]),
  sunrise: gradient("Sunrise", ["#fde68a", "#fda4af", "#c4b5fd"]),
  bubblegum: gradient("Bubblegum", ["#f9a8d4", "#c4b5fd", "#7dd3fc"]),
  lavender: gradient("Lavender", ["#e0e7ff", "#c4b5fd", "#818cf8"]),
  arctic: gradient("Arctic", ["#cffafe", "#67e8f9", "#3b82f6"]),
  citrus: gradient("Citrus", ["#fef08a", "#a3e635", "#16a34a"]),
  forest: gradient("Forest", ["#134e4a", "#15803d", "#a3e635"]),
  rose: gradient("Rose", ["#ffe4e6", "#fda4af", "#e11d48"]),
  cherry: gradient("Cherry", ["#fb7185", "#be123c", "#4c0519"]),
  copper: gradient("Copper", ["#fcd34d", "#b45309", "#451a03"]),
  steel: gradient("Steel", ["#e2e8f0", "#94a3b8", "#334155"]),
  midnight: gradient("Midnight", ["#0f172a", "#1e3a8a", "#6d28d9"]),
  carbon: gradient("Carbon", ["#3f3f46", "#18181b", "#09090b"]),
  aurora: wallpaper("Aurora", "aurora.jpg", ["#0b1d3a", "#14b8a6", "#7c3aed"]),
  ember: wallpaper("Ember", "ember.jpg", ["#3b0a1a", "#ea580c", "#db2777"]),
  lagoon: wallpaper("Lagoon", "lagoon.jpg", ["#042f4a", "#0891b2", "#34d399"]),
  orchid: wallpaper("Orchid", "orchid.jpg", ["#2e1065", "#c026d3", "#f472b6"]),
  sorbet: wallpaper("Sorbet", "sorbet.jpg", ["#fde2cf", "#fbcfe8", "#c7d2fe"]),
  slate: wallpaper("Slate", "slate.jpg", ["#0f172a", "#334155", "#475569"]),
  dunes: wallpaper("Dunes", "dunes.jpg", ["#fcd9b6", "#e08a5b", "#7a3b2e"]),
  hills: wallpaper("Hills", "hills.jpg", ["#1e1b4b", "#4338ca", "#0f172a"]),
  ribbons: wallpaper("Ribbons", "ribbons.jpg", ["#1e1b4b", "#db2777", "#38bdf8"]),
  tide: wallpaper("Tide", "tide.jpg", ["#022c3a", "#0e7490", "#a5f3fc"]),
}

const LAYOUTS: ReadonlyArray<StageLayout> = ["bubble", "side", "split", "screen", "camera", "focus"]
const CORNERS: ReadonlyArray<BubbleCorner> = ["tl", "tr", "bl", "br"]
const SIZES: ReadonlyArray<BubbleSize> = ["s", "m", "l"]
const SHAPES: ReadonlyArray<BubbleShape> = ["circle", "rounded", "portrait"]

export const SCALE_RANGE = { min: 0.08, max: 0.45 }
export const SPLIT_RANGE = { min: 0.25, max: 0.5, default: 0.36 }
/** Screen width in the camera-first layout, as a fraction of the stage width. */
export const FOCUS_RANGE = { min: 0.2, max: 0.45, default: 0.34 }

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
    layout: pick(input.layout, LAYOUTS, DEFAULT_STYLE.layout),
    corner: pick(input.corner, CORNERS, DEFAULT_STYLE.corner),
    size: pick(input.size, SIZES, DEFAULT_STYLE.size),
    shape: pick(input.shape, SHAPES, DEFAULT_STYLE.shape),
    background:
      typeof input.background === "string" && Object.hasOwn(BACKGROUNDS, input.background)
        ? input.background
        : DEFAULT_STYLE.background,
  }
}

/** In the camera-first layout the camera sits underneath and the screen floats above it. */
export const isCameraFirst = (layout: StageLayout, hasCamera: boolean) => hasCamera && layout === "focus"

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

  if (layout === "focus") {
    // The camera fills the stage; the screen keeps its own aspect, so its height in percent equals its width in percent.
    const margin = 2.5
    const width = clamp(style.scale ?? FOCUS_RANGE.default, FOCUS_RANGE.min, FOCUS_RANGE.max) * 100
    const fit = Math.min(width, 100 - margin * aspect * 2)
    return {
      stageAspect: aspect,
      screen: { left: left ? margin : 100 - margin - fit, top: 100 - margin * aspect - fit, width: fit, height: fit },
      camera: { left: 0, top: 0, width: 100, height: 100 },
    }
  }

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
