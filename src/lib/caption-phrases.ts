import type { Transcript, TranscriptWord } from "@/lib/transcript"

export interface Phrase {
  start: number
  end: number
  text: string
  words: Array<TranscriptWord>
}

const MAX_WORDS = 7
const PAUSE = 0.7

/** Short on-screen phrases from word timings; falls back to the transcript's own cues without them. */
export function phrasesOf(transcript: Transcript): Array<Phrase> {
  const words = transcript.words ?? []
  if (words.length === 0) return transcript.cues.map((cue) => ({ start: cue.start, end: cue.end, text: cue.text, words: [] }))
  const result: Array<Phrase> = []
  let current: Array<TranscriptWord> = []
  const flush = () => {
    if (current.length === 0) return
    result.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((word) => word.text).join(" "), words: current })
    current = []
  }
  for (const [index, word] of words.entries()) {
    const previous = words[index - 1]
    if (previous && word.start - previous.end > PAUSE) flush()
    current.push(word)
    if (current.length >= MAX_WORDS || (/[.!?]$/.test(word.text) && current.length >= 2)) flush()
  }
  flush()
  return result
}
