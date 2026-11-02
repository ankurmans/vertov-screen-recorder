export interface ZoomPoint {
  id: string
  start: number
  duration: number
  x: number
  y: number
  scale: number
}

export interface ZoomClick {
  t: number
  x: number
  y: number
}

export const MAX_ZOOMS = 100
export const ZOOM_EASE = 0.45
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

export function parseZooms(raw: unknown): ZoomPoint[] {
  if (!Array.isArray(raw)) return []
  const points: ZoomPoint[] = []
  for (const [index, value] of raw.slice(0, MAX_ZOOMS).entries()) {
    if (!value || typeof value !== "object") continue
    const p = value as Record<string, unknown>
    if (![p.start, p.duration, p.x, p.y, p.scale].every(finite)) continue
    if ((p.start as number) < 0 || (p.duration as number) < 1 || (p.scale as number) <= 1) continue
    points.push({
      id: typeof p.id === "string" && /^[\w-]{1,64}$/.test(p.id) ? p.id : `zoom-${index}`,
      start: p.start as number,
      duration: clamp(p.duration as number, 1, 12),
      x: clamp(p.x as number, 0, 1),
      y: clamp(p.y as number, 0, 1),
      scale: clamp(p.scale as number, 1.25, 2.5),
    })
  }
  points.sort((a, b) => a.start - b.start)
  const normalized: ZoomPoint[] = []
  const ids = new Set<string>()
  for (const point of points) {
    const previous = normalized.at(-1)
    if (previous && point.start < previous.start + previous.duration) continue
    let id = point.id
    let suffix = normalized.length
    while (ids.has(id)) id = `zoom-generated-${suffix++}`
    ids.add(id)
    normalized.push({ ...point, id })
  }
  return normalized
}

const smooth = (value: number) => {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

/** Translation is a fraction of the unscaled screen, matching the export crop. */
export function zoomAt(points: readonly ZoomPoint[], time: number) {
  const point = points.find((p) => time >= p.start && time < p.start + p.duration)
  if (!point) return { scale: 1, x: 0, y: 0 }
  const ease = Math.min(ZOOM_EASE, point.duration / 3)
  const amount = smooth((time - point.start) / ease) * smooth((point.start + point.duration - time) / ease)
  const scale = 1 + (point.scale - 1) * amount
  return { scale, x: clamp(0.5 - point.x * scale, 1 - scale, 0), y: clamp(0.5 - point.y * scale, 1 - scale, 0) }
}

export function zoomsFromClicks(clicks: readonly ZoomClick[], duration: number): ZoomPoint[] {
  const points: ZoomPoint[] = []
  const ordered = clicks.filter((p) => finite(p.t) && finite(p.x) && finite(p.y) && p.t >= 0 && p.t < duration)
    .slice().sort((a, b) => a.t - b.t)
  for (const click of ordered) {
    const previous = points.at(-1)
    if (previous && click.t < previous.start + previous.duration + 0.6) {
      if (Math.hypot(click.x - previous.x, click.y - previous.y) < 0.16) {
        previous.duration = Math.min(8, duration - previous.start, Math.max(previous.duration, click.t + 2 - previous.start))
      }
      continue
    }
    const start = Math.max(0, click.t - 0.2)
    if (duration - start < 1) continue
    points.push({ id: `click-${points.length}-${Math.round(click.t * 1000)}`, start, duration: Math.min(3.5, duration - start), x: clamp(click.x, 0, 1), y: clamp(click.y, 0, 1), scale: 1.6 })
    if (points.length === MAX_ZOOMS) break
  }
  return points
}
