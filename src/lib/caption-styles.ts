
export type CaptionStyle = "off" | "clean"

const ALL_STYLES: Array<{ value: CaptionStyle; label: string; hint: string }> = [
  { value: "off", label: "Player controls", hint: "Auto-generated subtitles. Viewers turn them on or off in the player's Settings → Captions." },
  { value: "clean", label: "Clean", hint: "White text on a soft dark box. Shown to everyone and included in MP4 exports." },
]

export const CAPTION_STYLES = ALL_STYLES

export const isCaptionStyle = (value: unknown): value is CaptionStyle =>
  typeof value === "string" && CAPTION_STYLES.some((style) => style.value === value)
