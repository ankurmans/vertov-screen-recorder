// Click zooms and the cursor overlay are part of the hosted service and are not included in this edition.
import type { Upload } from "@/db/schema"
import type { ZoomClick } from "@/lib/zooms"
import type { CursorTrack } from "@/lib/cursor"

export async function recordedZoomClicks(_upload: Upload): Promise<ZoomClick[]> {
  return []
}

export async function cursorTrack(_upload: Upload): Promise<CursorTrack | null> {
  return null
}
