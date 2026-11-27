// Click and manual zooms are part of the hosted service and are not included in this edition.
// Stored zooms are ignored, so the player and exports show the full frame.

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

export const MAX_ZOOMS = 0
export const ZOOM_EASE = 0.45

export function parseZooms(_raw: unknown): Array<ZoomPoint> {
  return []
}

export function zoomAt(_points: ReadonlyArray<ZoomPoint>, _time: number) {
  return { scale: 1, x: 0, y: 0 }
}

export function zoomsFromClicks(_clicks: ReadonlyArray<ZoomClick>, _duration: number): Array<ZoomPoint> {
  return []
}
