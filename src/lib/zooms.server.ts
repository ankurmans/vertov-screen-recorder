// Click zooms are part of the hosted service and are not included in this edition.
import type { Upload } from "@/db/schema"
import type { ZoomClick } from "@/lib/zooms"

export async function recordedZoomClicks(_upload: Upload): Promise<ZoomClick[]> {
  return []
}
