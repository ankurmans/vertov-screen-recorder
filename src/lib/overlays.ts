/**
 * Annotations drawn over the video at playback: text, boxes, arrows, clickable links, blurred and
 * spotlit regions, and images, each with a time range.
 * Positions are percent of the stage, so they stay put at any player size. Stored as JSON on the
 * upload; the original video is never touched.
 */

import { HOSTED_EDITION } from "@/lib/edition"

export type OverlayType = "text" | "box" | "arrow" | "link" | "blur" | "spotlight" | "image"

/** Effect overlays the public edition doesn't include; parsing drops them there. */
export const HOSTED_OVERLAYS: ReadonlyArray<OverlayType> = ["blur", "spotlight", "image"]

export interface Overlay {
  id: string
  type: OverlayType
  /** Seconds on the source timeline. */
  start: number
  end: number
  /** Percent of the stage width and height. Text anchors at its top-left. */
  x: number
  y: number
  /** Box size in percent (blur, spotlight and box; image uses `w` and keeps its aspect). */
  w: number
  h: number
  /** Arrow tail is (x, y); its head is (x2, y2). */
  x2: number
  y2: number
  text: string
  /** Link target for type "link"; the label is `text`. */
  url: string
  color: string
  /** Text size in percent of the stage width. */
  size: number
  /** Image overlays: the uploaded file's path, see IMAGE_PATH. */
  src: string
}

/** Overlay images are stored per video and served (behind the video's own access rules) from here. */
export const IMAGE_PATH = /^\/api\/overlay-image\/[a-f0-9]{8}\/[a-f0-9]{16}\.(png|jpg|webp)$/

export const OVERLAY_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff", "#111111"] as const
export const MAX_OVERLAYS = 100

const TYPES: ReadonlyArray<OverlayType> = ["text", "box", "arrow", "link", "blur", "spotlight", "image"]

/** Only web links; anything else (javascript:, data:) is dropped. */
export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim().slice(0, 2000)
  if (!trimmed) return ""
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""
  } catch {
    return ""
  }
}
const num = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export function parseOverlays(raw: unknown): Array<Overlay> {
  let value: unknown = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const result: Array<Overlay> = []
  for (const item of value.slice(0, MAX_OVERLAYS)) {
    if (typeof item !== "object" || item === null) continue
    const input = item as Record<string, unknown>
    const type = TYPES.find((candidate) => candidate === input.type)
    if (!type || (!HOSTED_EDITION && HOSTED_OVERLAYS.includes(type))) continue
    const src = typeof input.src === "string" && IMAGE_PATH.test(input.src) ? input.src : ""
    if (type === "image" && !src) continue
    const start = num(input.start, 0, 60 * 60 * 6, 0)
    result.push({
      id: typeof input.id === "string" && input.id.length <= 40 ? input.id : crypto.randomUUID(),
      type,
      start,
      end: Math.max(start + 0.5, num(input.end, 0, 60 * 60 * 6, start + 4)),
      x: num(input.x, -20, 120, 30),
      y: num(input.y, -20, 120, 30),
      w: num(input.w, 1, 120, 24),
      h: num(input.h, 1, 120, 16),
      x2: num(input.x2, -20, 120, 55),
      y2: num(input.y2, -20, 120, 55),
      text: typeof input.text === "string" ? input.text.slice(0, 200) : "",
      url: safeUrl(input.url),
      color: typeof input.color === "string" && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : OVERLAY_COLORS[0],
      size: num(input.size, 1, 12, 3.2),
      src,
    })
  }
  return result
}

export function newOverlay(type: OverlayType, at: number, src = ""): Overlay {
  return {
    id: crypto.randomUUID(),
    type,
    start: Math.max(0, Math.round(at * 10) / 10),
    end: Math.round((at + 4) * 10) / 10,
    x: type === "arrow" ? 30 : 32,
    y: type === "arrow" ? 30 : type === "text" || type === "link" ? 40 : 30,
    w: type === "image" ? 20 : 26,
    h: 18,
    x2: 52,
    y2: 52,
    text: type === "text" ? "Your text" : type === "link" ? "Learn more" : "",
    url: "",
    color: OVERLAY_COLORS[0],
    size: 3.6,
    src,
  }
}

export const isActive = (overlay: Overlay, time: number) => time >= overlay.start && time < overlay.end
