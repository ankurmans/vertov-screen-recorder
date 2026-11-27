import type { Transcript, TranscriptCue, TranscriptWord } from "@/lib/transcript"

/** A removed stretch of the source video, [start, end] in seconds. */
export type Cut = [number, number]

const MAX_CUTS = 2000

/** Spoken fillers worth cutting. Lowercased, punctuation stripped before matching. */
const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "mm", "mhm"])

/** Sorted, merged, clamped cuts; anything malformed is dropped. */
export function normalizeCuts(raw: unknown, duration?: number | null): Array<Cut> {
  if (!Array.isArray(raw)) return []
  const cuts = raw
    .filter(
      (cut): cut is Cut =>
        Array.isArray(cut) &&
        cut.length === 2 &&
        Number.isFinite(cut[0]) &&
        Number.isFinite(cut[1]) &&
        cut[1] - cut[0] >= 0.05,
    )
    .map(([start, end]): Cut => [Math.max(0, start), duration ? Math.min(end, duration) : end])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  const merged: Array<Cut> = []
  for (const cut of cuts) {
    const last = merged.at(-1)
    if (last && cut[0] <= last[1] + 0.02) last[1] = Math.max(last[1], cut[1])
    else merged.push([cut[0], cut[1]])
  }
  return merged.slice(0, MAX_CUTS)
}

export function parseCuts(stored: string | null | undefined): Array<Cut> {
  if (!stored) return []
  try {
    return normalizeCuts(JSON.parse(stored))
  } catch {
    return []
  }
}

/** The cut playback is inside right now, if any. */
export function cutAt(cuts: Array<Cut>, time: number): Cut | null {
  for (const cut of cuts) {
    if (time < cut[0]) return null
    if (time < cut[1] - 0.02) return cut
  }
  return null
}

export function isWordCut(cuts: Array<Cut>, word: TranscriptWord): boolean {
  const middle = (word.start + word.end) / 2
  return cuts.some(([start, end]) => middle >= start && middle <= end)
}

export function cutSeconds(cuts: Array<Cut>): number {
  return cuts.reduce((total, [start, end]) => total + (end - start), 0)
}

const bare = (text: string) => text.toLowerCase().replace(/[^a-z']/g, "")

export function fillerCuts(words: Array<TranscriptWord>): Array<Cut> {
  return words.filter((word) => FILLERS.has(bare(word.text))).map((word): Cut => [word.start, word.end])
}

/** Silences longer than `longest` shrink to `keep`, half a breath on each side. */
export function pauseCuts(words: Array<TranscriptWord>, duration: number, longest = 1, keep = 0.4): Array<Cut> {
  const cuts: Array<Cut> = []
  const gap = (from: number, to: number) => {
    if (to - from > longest) cuts.push([from + keep / 2, to - keep / 2])
  }
  if (words.length === 0) return cuts
  gap(0, words[0].start)
  for (let index = 1; index < words.length; index += 1) gap(words[index - 1].end, words[index].start)
  if (duration) gap(words.at(-1)!.end, duration)
  return cuts
}

/** Removes `range` from the cuts, splitting any cut it lands inside. */
export function restoreRange(cuts: Array<Cut>, range: Cut): Array<Cut> {
  const result: Array<Cut> = []
  for (const [start, end] of cuts) {
    if (end <= range[0] || start >= range[1]) {
      result.push([start, end])
      continue
    }
    if (start < range[0]) result.push([start, range[0]])
    if (end > range[1]) result.push([range[1], end])
  }
  return normalizeCuts(result)
}

// An export maps every caption word and pointer sample, so the last list read is kept rather than parsed each time.
let lastRead: { stored: string | null; cuts: Array<Cut> } = { stored: null, cuts: [] }
const readCuts = (stored: string | null) => {
  if (stored !== lastRead.stored) lastRead = { stored, cuts: parseCuts(stored) }
  return lastRead.cuts
}

/**
 * Where a source-timeline moment lands in that clip's export: after its trim, with its cuts removed.
 * Null when the moment was trimmed away or cut out.
 */
export function mapToExport(source: { trimStart: number | null; trimEnd: number | null; cuts: string | null }, time: number): number | null {
  const start = source.trimStart ?? 0
  if (time < start || (source.trimEnd != null && time > source.trimEnd)) return null
  let removed = 0
  for (const [a, b] of readCuts(source.cuts)) {
    if (time > a && time < b) return null
    removed += Math.max(0, Math.min(b, time) - Math.max(a, start))
  }
  return time - start - removed
}

/** A video's edits as stored on its row. */
export type Edits = { trimStart: number | null; trimEnd: number | null; cuts: string | null }

/** A line without word timings is dropped when more than this much of it was removed (seconds). */
const SLACK = 0.25

/** Only the letters and digits of any script, to compare a line with its words. */
const letters = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

/** The line's text without the removed words, keeping its punctuation; null when a word can't be found in it. */
function without(text: string, words: Array<TranscriptWord>, gone: (word: TranscriptWord) => boolean): string | null {
  const lower = text.toLowerCase()
  let at = 0
  let from = 0
  let out = ""
  for (const word of words) {
    const found = lower.indexOf(word.text.toLowerCase(), at)
    if (found < 0) return null
    at = found + word.text.length
    if (!gone(word)) continue
    out += text.slice(from, found)
    // Punctuation hanging on a removed word goes with it.
    at += /^[^\s\p{L}\p{N}]*/u.exec(text.slice(at))![0].length
    from = at
  }
  return (out + text.slice(from)).replace(/\s+/g, " ").trim()
}

/** Everything viewers never see: before the trim start, every cut, after the trim end. */
const removedRanges = (source: Edits): Array<Cut> => [
  ...(source.trimStart ? [[0, source.trimStart] as Cut] : []),
  ...parseCuts(source.cuts),
  ...(source.trimEnd != null ? [[source.trimEnd, Number.MAX_SAFE_INTEGER] as Cut] : []),
]

const wordsOf = (cue: TranscriptCue, words: Array<TranscriptWord>) => words.filter((word) => (word.start + word.end) / 2 >= cue.start && (word.start + word.end) / 2 <= cue.end)

const spells = (text: string, words: Array<TranscriptWord>) => letters(text) === letters(words.map((word) => word.text).join(""))

/**
 * The transcript as viewers get it: nothing said before the trim start, after the trim end or inside a cut. The stored
 * transcript is untouched; only the editor shows all of it.
 */
export function visibleTranscript(transcript: Transcript | null, source: Edits): Transcript | null {
  const removed = removedRanges(source)
  if (!transcript || removed.length === 0) return transcript
  const gone = (word: TranscriptWord) => isWordCut(removed, word)
  const words = transcript.words ?? []
  const cues = transcript.cues.flatMap((cue): Array<TranscriptCue> => {
    const overlap = removed.reduce((total, [start, end]) => total + Math.max(0, Math.min(end, cue.end) - Math.max(start, cue.start)), 0)
    if (overlap === 0 && !words.some((word) => word.end > cue.start && word.start < cue.end && gone(word))) return [cue]
    const own = wordsOf(cue, words)
    if (own.length === 0) return overlap > SLACK ? [] : [cue]
    const kept = own.filter((word) => !gone(word))
    if (kept.length === 0) return []
    // The line must come out as exactly the words kept; if the text and timings disagree, it is rebuilt from those.
    const edited = without(cue.text, own, gone)
    const text = edited !== null && spells(edited, kept) ? edited : kept.map((word) => word.text).join(/\s/.test(cue.text) ? " " : "")
    if (kept.length < own.length) return [{ start: kept[0].start, end: kept.at(-1)!.end, text }]
    return [text === cue.text ? cue : { ...cue, text }]
  })
  if (cues.length === 0) return null
  return { cues, words: transcript.words && words.filter((word) => !gone(word)) }
}

/** The lines whose translation can still be shown: nothing was removed from them but filler words. */
export function translatableLines(transcript: Transcript | null, source: Edits): Array<TranscriptCue> {
  if (!transcript) return []
  const removed = removedRanges(source)
  const unchanged = new Set(visibleTranscript(transcript, source)?.cues)
  return transcript.cues.filter((cue) => {
    if (unchanged.has(cue)) return true
    const own = wordsOf(cue, transcript.words ?? [])
    const lost = own.filter((word) => isWordCut(removed, word))
    return lost.length < own.length && lost.every((word) => FILLERS.has(bare(word.text))) && spells(cue.text, own)
  })
}

/** Whether viewers lost speech between the `before` and `after` edits. Fillers and silences don't count. */
export function removedSpeech(transcript: Transcript | null, before: Edits, after: Edits): boolean {
  if (!transcript) return false
  const was = removedRanges(before)
  const is = removedRanges(after)
  const words = transcript.words ?? []
  if (words.some((word) => /[\p{L}\p{N}]/u.test(word.text) && !FILLERS.has(bare(word.text)) && !isWordCut(was, word) && isWordCut(is, word))) return true
  // A line without word timings has no words to compare: it counts when viewers had it and now don't.
  const shown = new Set(visibleTranscript(transcript, after)?.cues)
  return (visibleTranscript(transcript, before)?.cues ?? []).some((cue) => !shown.has(cue) && wordsOf(cue, words).length === 0)
}

/** The chapters viewers still have: one whose whole section was removed goes. The stored list is untouched. */
export function visibleChapters<T extends { start: number }>(chapters: Array<T>, source: Edits, duration?: number | null): Array<T> {
  const removed = normalizeCuts(removedRanges(source))
  if (removed.length === 0) return chapters
  return chapters.filter((chapter, index) => {
    const end = chapters[index + 1]?.start ?? duration ?? Number.MAX_SAFE_INTEGER
    return !removed.some(([from, to]) => from <= chapter.start + 0.3 && to >= end - 0.3)
  })
}
