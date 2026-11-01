import { phrasesOf } from "@/lib/caption-phrases"
import type { CaptionStyle } from "@/lib/caption-styles"
import { mapToExport } from "@/lib/cuts"
import type { Overlay } from "@/lib/overlays"
import type { Transcript } from "@/lib/transcript"

interface Source {
  trimStart: number | null
  trimEnd: number | null
  cuts: string | null
}

/** ASS colour: &HAABBGGRR, where alpha 00 is opaque. */
const colour = (hex: string, alpha = 0) => {
  const value = hex.replace("#", "")
  const r = value.slice(0, 2)
  const g = value.slice(2, 4)
  const b = value.slice(4, 6)
  return `&H${alpha.toString(16).padStart(2, "0")}${b}${g}${r}`.toUpperCase()
}

const stamp = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds * 100))
  const cs = total % 100
  const s = Math.floor(total / 100) % 60
  const m = Math.floor(total / 6000) % 60
  const h = Math.floor(total / 360000)
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`
}

const escape = (text: string) => text.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N")
const n = (value: number) => Math.round(value * 10) / 10

/**
 * Burns the owner's annotations and styled captions into the export as one ASS script, positioned in
 * export pixels. Times are mapped from the source timeline through trim and cuts, matching the video.
 * Empty when there is nothing to draw.
 */
export function buildAss(options: {
  width: number
  height: number
  overlays: Array<Overlay>
  transcript: Transcript | null
  captionStyle: CaptionStyle
  source: Source
}): string {
  const { width, height, overlays, transcript, captionStyle, source } = options
  const lines: Array<string> = []
  const event = (layer: number, start: number, end: number, style: string, text: string) =>
    lines.push(`Dialogue: ${layer},${stamp(start)},${stamp(end)},${style},,0,0,0,,${text}`)
  const span = (from: number, to: number): [number, number] | null => {
    const start = mapToExport(source, from)
    if (start == null) return null
    const end = mapToExport(source, to) ?? start + (to - from)
    return end - start >= 0.05 ? [start, end] : null
  }

  const px = (percentX: number) => (percentX / 100) * width
  const py = (percentY: number) => (percentY / 100) * height

  for (const overlay of overlays) {
    const range = span(overlay.start, overlay.end)
    if (!range) continue
    const [start, end] = range
    const c = colour(overlay.color)
    if (overlay.type === "text" && overlay.text) {
      const size = (overlay.size / 100) * width
      const shadow = overlay.color.toLowerCase() === "#111111" ? colour("#ffffff", 0x60) : colour("#000000", 0x50)
      event(2, start, end, "Note", `{\\an7\\pos(${n(px(overlay.x))},${n(py(overlay.y))})\\fs${n(size)}\\1c${c}\\3c${shadow}\\bord${n(size / 14)}\\shad0}${escape(overlay.text)}`)
    } else if (overlay.type === "box") {
      const stroke = 0.0045 * width
      const w = px(overlay.w)
      const h = py(overlay.h)
      event(1, start, end, "Note", `{\\an7\\pos(${n(px(overlay.x))},${n(py(overlay.y))})\\1a&HFF&\\3c${c}\\3a&H00&\\bord${n(stroke)}\\shad0\\p1}m 0 0 l ${n(w)} 0 ${n(w)} ${n(h)} 0 ${n(h)}{\\p0}`)
    } else if (overlay.type === "arrow") {
      const x1 = px(overlay.x)
      const y1 = py(overlay.y)
      const x2 = px(overlay.x2)
      const y2 = py(overlay.y2)
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const head = 0.034 * height
      const half = 0.0045 * height
      const bx = x2 - head * 0.6 * Math.cos(angle)
      const by = y2 - head * 0.6 * Math.sin(angle)
      const nx = -Math.sin(angle) * half
      const ny = Math.cos(angle) * half
      const left = [x2 - head * Math.cos(angle - 0.5), y2 - head * Math.sin(angle - 0.5)]
      const right = [x2 - head * Math.cos(angle + 0.5), y2 - head * Math.sin(angle + 0.5)]
      const shaft = `m ${n(x1 + nx)} ${n(y1 + ny)} l ${n(bx + nx)} ${n(by + ny)} ${n(bx - nx)} ${n(by - ny)} ${n(x1 - nx)} ${n(y1 - ny)}`
      const tip = `m ${n(x2)} ${n(y2)} l ${n(left[0])} ${n(left[1])} ${n(right[0])} ${n(right[1])}`
      event(1, start, end, "Note", `{\\an7\\pos(0,0)\\1c${c}\\3c${colour("#000000", 0x80)}\\bord${n(height / 400)}\\shad0\\p1}${shaft} ${tip}{\\p0}`)
    } else if (overlay.type === "link" && overlay.text) {
      const size = (Math.min(overlay.size, 5) / 100) * width
      const padX = 0.016 * width
      const padY = 0.006 * width
      // The pill needs a width; estimate from the label length (ASS can't measure text).
      const w = overlay.text.length * size * 0.56 + padX * 2
      const h = size * 1.2 + padY * 2
      const r = h / 2
      const x = px(overlay.x)
      const y = py(overlay.y)
      const pill = `m ${n(r)} 0 l ${n(w - r)} 0 b ${n(w)} 0 ${n(w)} ${n(h)} ${n(w - r)} ${n(h)} l ${n(r)} ${n(h)} b 0 ${n(h)} 0 0 ${n(r)} 0`
      event(1, start, end, "Note", `{\\an7\\pos(${n(x)},${n(y)})\\1c${c}\\bord0\\shad0\\p1}${pill}{\\p0}`)
      const ink = overlay.color.toLowerCase() === "#ffffff" ? "#111111" : "#ffffff"
      event(2, start, end, "Note", `{\\an5\\pos(${n(x + w / 2)},${n(y + h / 2)})\\fs${n(size)}\\1c${colour(ink)}\\bord0\\shad0\\b1}${escape(overlay.text)}`)
    }
  }

  if (transcript && captionStyle !== "off") {
    const phrases = phrasesOf(transcript)
    for (const [index, phrase] of phrases.entries()) {
      // Linger a moment past the last word, but never over the next phrase.
      const next = phrases[index + 1]
      const range = span(phrase.start, Math.min(phrase.end + 0.1, next ? Math.max(next.start, phrase.end) : Infinity))
      if (!range) continue
      const [start, end] = range
      const style = captionStyle === "bold" ? "CapBold" : captionStyle === "karaoke" ? "CapKaraoke" : "CapClean"
      let text = escape(captionStyle === "bold" ? phrase.text.toUpperCase() : phrase.text)
      if (captionStyle === "karaoke" && phrase.words.length > 0) {
        text = phrase.words
          .map((word, index) => {
            const next = phrase.words[index + 1]
            const length = Math.max(0.05, (next ? next.start : word.end) - word.start)
            return `{\\kf${Math.round(length * 100)}}${escape(word.text)} `
          })
          .join("")
      }
      event(3, start, end, style, text)
    }
  }

  if (lines.length === 0) return ""
  const fs = (percent: number) => n((percent / 100) * width)
  const margin = Math.round(height * 0.14)
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Note,DejaVu Sans,${fs(3.2)},&H00FFFFFF,&H00FFFFFF,&H80000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: CapClean,DejaVu Sans,${fs(3)},&H00FFFFFF,&H00FFFFFF,&HA0000000,&HA0000000,-1,0,0,0,100,100,0,0,3,${fs(0.7)},0,2,${Math.round(width * 0.07)},${Math.round(width * 0.07)},${margin},1`,
    `Style: CapBold,DejaVu Sans,${fs(4.4)},${colour("#fde047")},${colour("#fde047")},&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,${fs(0.45)},${fs(0.15)},2,${Math.round(width * 0.07)},${Math.round(width * 0.07)},${margin},1`,
    // Karaoke: words sweep from the secondary colour (not yet said) to the primary (said).
    `Style: CapKaraoke,DejaVu Sans,${fs(3)},${colour("#fde047")},&H99FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${fs(0.4)},${fs(0.12)},2,${Math.round(width * 0.07)},${Math.round(width * 0.07)},${margin},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...lines,
    "",
  ].join("\n")
}
