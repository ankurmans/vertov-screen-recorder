import type { TranscriptWord } from "@/lib/transcript"

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

/**
 * Where a source-timeline moment lands in that clip's export: after its trim, with its cuts removed.
 * Null when the moment was trimmed away or cut out.
 */
export function mapToExport(source: { trimStart: number | null; trimEnd: number | null; cuts: string | null }, time: number): number | null {
  const start = source.trimStart ?? 0
  if (time < start || (source.trimEnd != null && time > source.trimEnd)) return null
  let removed = 0
  for (const [a, b] of parseCuts(source.cuts)) {
    if (time > a && time < b) return null
    removed += Math.max(0, Math.min(b, time) - Math.max(a, start))
  }
  return time - start - removed
}
