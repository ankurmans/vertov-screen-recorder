import type { ZoomPoint } from "@/lib/zooms"

// Zooms are part of the hosted service and are not included in this edition.

export type ZoomFocusPicker = ((x: number, y: number) => void) | null

export function ZoomEditor(_props: {
  uploadId: string
  points: Array<ZoomPoint>
  currentTime: number
  duration: number
  onChange: (points: Array<ZoomPoint>) => void
  onSeek: (time: number) => void
  onPickFocus: (picker: ZoomFocusPicker) => void
  screenVisible: boolean
}) {
  return null
}
