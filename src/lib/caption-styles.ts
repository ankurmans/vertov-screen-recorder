export type CaptionStyle = "off" | "clean" | "bold" | "karaoke"

export const CAPTION_STYLES: Array<{ value: CaptionStyle; label: string; hint: string }> = [
  { value: "off", label: "Browser default", hint: "The player's own captions button." },
  { value: "clean", label: "Clean", hint: "White text on a soft dark box." },
  { value: "bold", label: "Bold", hint: "Big yellow text with an outline." },
  { value: "karaoke", label: "Karaoke", hint: "Words light up as they're said." },
]

export const isCaptionStyle = (value: unknown): value is CaptionStyle =>
  typeof value === "string" && CAPTION_STYLES.some((style) => style.value === value)
