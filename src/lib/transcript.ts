/**
 * Transcript sidecar format shared between the Screendrop app (producer)
 * and the share page (consumer). Times are seconds on the exported
 * video's timeline.
 */

export interface TranscriptCue {
  start: number
  end: number
  text: string
}

export interface TranscriptWord {
  text: string
  start: number
  end: number
}

export interface Transcript {
  cues: Array<TranscriptCue>
  /** Word-level timing when available; powers karaoke highlighting. */
  words?: Array<TranscriptWord>
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** Validates untrusted JSON into a Transcript, dropping malformed entries. */
export function parseTranscript(raw: unknown): Transcript | null {
  if (typeof raw !== "object" || raw === null) return null
  const candidate = raw as { cues?: unknown; words?: unknown }
  if (!Array.isArray(candidate.cues)) return null

  const cues = candidate.cues
    .filter(
      (cue): cue is TranscriptCue =>
        typeof cue === "object" &&
        cue !== null &&
        isFiniteNumber((cue as TranscriptCue).start) &&
        isFiniteNumber((cue as TranscriptCue).end) &&
        (cue as TranscriptCue).end > (cue as TranscriptCue).start &&
        typeof (cue as TranscriptCue).text === "string" &&
        (cue as TranscriptCue).text.length > 0,
    )
    .map((cue) => ({ start: cue.start, end: cue.end, text: cue.text }))
    .sort((a, b) => a.start - b.start)

  if (cues.length === 0) return null

  let words: Array<TranscriptWord> | undefined
  if (Array.isArray(candidate.words)) {
    words = candidate.words
      .filter(
        (word): word is TranscriptWord =>
          typeof word === "object" &&
          word !== null &&
          isFiniteNumber((word as TranscriptWord).start) &&
          isFiniteNumber((word as TranscriptWord).end) &&
          typeof (word as TranscriptWord).text === "string" &&
          (word as TranscriptWord).text.length > 0,
      )
      .map((word) => ({ text: word.text, start: word.start, end: word.end }))
      .sort((a, b) => a.start - b.start)
    if (words.length === 0) words = undefined
  }

  return { cues, words }
}

function vttTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const secs = Math.floor(clamped % 60)
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

/** WebVTT document for the native <track> captions. */
/** SubRip from WebVTT: numbered cues, comma decimal separator, no header, notes or cue settings. */
export function vttToSrt(vtt: string): string {
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/)
  const out: Array<string> = []
  for (const block of blocks) {
    const lines = block.split("\n")
    const at = lines.findIndex((line) => line.includes("-->"))
    if (at === -1) continue
    const [from, to] = lines[at].split("-->").map((part) => part.trim().split(/\s+/)[0])
    const stamp = (value: string) => (value.split(":").length === 2 ? `00:${value}` : value).replace(".", ",")
    const text = lines.slice(at + 1).join("\n").trim()
    if (!text) continue
    out.push(`${out.length + 1}\n${stamp(from)} --> ${stamp(to)}\n${text}\n`)
  }
  return out.join("\n")
}

export function transcriptToVtt(transcript: Transcript): string {
  const lines = ["WEBVTT", ""]
  for (const cue of transcript.cues) {
    lines.push(`${vttTimestamp(cue.start)} --> ${vttTimestamp(cue.end)}`)
    lines.push(cue.text)
    lines.push("")
  }
  return lines.join("\n")
}

/** The transcript's plain text, as library search reads it. */
export const searchText = (transcript: Transcript | null) => (transcript ? transcript.cues.map((cue) => cue.text).join(" ").slice(0, 100_000) : null)

/** A stored WebVTT document (a translation) with only the blocks timed like one of `cues`. */
export function onlyCues(vtt: string, cues: Array<TranscriptCue>): string {
  const timed = new Set(cues.map((cue) => `${vttTimestamp(cue.start)} --> ${vttTimestamp(cue.end)}`))
  const blocks = vtt.split(/\n{2,}/).filter((block) => !block.includes("-->") || timed.has(block.split("\n").find((line) => line.includes("-->"))!.trim()))
  return blocks.join("\n\n")
}

/** Words spoken, for the "words you didn't type" line. Falls back to the caption lines when there are no word timings. */
export function spokenWords(transcript: Transcript | null): number {
  if (!transcript) return 0
  if (transcript.words?.length) return transcript.words.length
  return transcript.cues.reduce((total, cue) => total + (cue.text.match(/\S+/g)?.length ?? 0), 0)
}
