import { env } from "cloudflare:workers"
import type { Upload } from "@/db/schema"
import type { ZoomClick } from "@/lib/zooms"

/** Only tab capture has a reliable mapping from page coordinates to the recorded picture. */
export async function recordedZoomClicks(upload: Upload): Promise<ZoomClick[]> {
  const object = await env.BUCKET.get(`uploads/${upload.id}/events`)
  if (!object || object.size > 2 * 1024 * 1024) return []
  const events: unknown = await object.json().catch(() => null)
  if (!Array.isArray(events) || !upload.width || !upload.height) return []
  const points: ZoomClick[] = []
  for (const event of events.slice(0, 5000)) {
    if (!event || event.type !== "click" || event.coordinateSpace !== "recorded-tab") continue
    const { t, x, y, viewportWidth, viewportHeight } = event
    if (![t, x, y, viewportWidth, viewportHeight].every((n) => typeof n === "number" && Number.isFinite(n))) continue
    if (t < 0 || x < 0 || x > 1 || y < 0 || y > 1 || viewportWidth <= 0 || viewportHeight <= 0) continue
    const scale = Math.min(upload.width / viewportWidth, upload.height / viewportHeight)
    const width = viewportWidth * scale / upload.width
    const height = viewportHeight * scale / upload.height
    points.push({ t, x: (1 - width) / 2 + x * width, y: (1 - height) / 2 + y * height })
  }
  return points
}
