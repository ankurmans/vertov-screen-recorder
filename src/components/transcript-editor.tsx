import { ArrowCounterClockwiseIcon, MicrophoneSlashIcon, ScissorsIcon, TimerIcon } from "@phosphor-icons/react"
import { useMemo, useRef, useState } from "react"
import type { Cut } from "@/lib/cuts"
import type { Transcript } from "@/lib/transcript"
import { cutSeconds, fillerCuts, isWordCut, normalizeCuts, pauseCuts, restoreRange } from "@/lib/cuts"
import { formatDuration } from "@/lib/format"

/**
 * Edit the video by editing its words: select text and cut it, or clear
 * every filler word and long pause in one click. Cuts are skipped at
 * playback and baked into exports; the original file is never touched.
 */
export function TranscriptEditor({
  transcript,
  cuts,
  duration,
  currentTime,
  onSeek,
  onChange,
  className,
}: {
  transcript: Transcript
  cuts: Array<Cut>
  duration: number
  currentTime: number
  onSeek: (time: number) => void
  onChange: (cuts: Array<Cut>) => void
  className?: string
}) {
  const words = transcript.words ?? []
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const fillers = useMemo(() => fillerCuts(words), [words])
  const fillersLeft = fillers.filter(([start, end]) => !isWordCut(cuts, { text: "", start, end })).length
  const pauses = useMemo(() => pauseCuts(words, duration), [words, duration])
  const removed = cutSeconds(cuts)

  if (words.length === 0) {
    return (
      <div className={`p-4 text-sm text-neutral-500 ${className ?? ""}`}>
        This video has no word timings, so it can't be edited by text.
      </div>
    )
  }

  function readSelection() {
    const native = window.getSelection()
    if (!native || native.isCollapsed || !rootRef.current) return setSelection(null)
    const indexOf = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement
      const word = element?.closest<HTMLElement>("[data-word]")
      return word ? Number(word.dataset.word) : null
    }
    const a = indexOf(native.anchorNode)
    const b = indexOf(native.focusNode)
    if (a == null || b == null) return setSelection(null)
    setSelection({ from: Math.min(a, b), to: Math.max(a, b) })
  }

  function applyToSelection(kind: "cut" | "restore") {
    if (!selection) return
    // Reach to the neighbouring words so the cut takes the breath with it.
    const start = selection.from > 0 ? words[selection.from - 1].end : 0
    const end = selection.to < words.length - 1 ? words[selection.to + 1].start : duration
    const range: Cut = [Math.max(start, words[selection.from].start - 0.15), Math.min(end, words[selection.to].end + 0.1)]
    onChange(kind === "cut" ? normalizeCuts([...cuts, range], duration) : restoreRange(cuts, range))
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const selectionCut =
    selection != null && words.slice(selection.from, selection.to + 1).every((word) => isWordCut(cuts, word))

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      <div className="shrink-0 space-y-2 px-3 pb-3">
        <div className="flex flex-wrap gap-1.5">
          <ToolButton
            disabled={fillersLeft === 0}
            onClick={() => onChange(normalizeCuts([...cuts, ...fillers], duration))}
            icon={<MicrophoneSlashIcon size={14} />}
          >
            {fillers.length === 0
              ? "No filler words"
              : fillersLeft === 0
                ? "Filler words removed"
                : `Remove ${fillersLeft} filler word${fillersLeft === 1 ? "" : "s"}`}
          </ToolButton>
          <ToolButton
            disabled={pauses.length === 0}
            onClick={() => onChange(normalizeCuts([...cuts, ...pauses], duration))}
            icon={<TimerIcon size={14} />}
          >
            {pauses.length === 0 ? "No long pauses" : `Shorten ${pauses.length} pause${pauses.length === 1 ? "" : "s"}`}
          </ToolButton>
          {cuts.length > 0 && (
            <ToolButton onClick={() => onChange([])} icon={<ArrowCounterClockwiseIcon size={14} />}>
              Restore all
            </ToolButton>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          {cuts.length > 0
            ? `${formatDuration(removed)} removed. Plays in ${formatDuration(Math.max(0, duration - removed))}.`
            : "Select words and cut them. Click a word to jump there."}
        </p>
      </div>

      <div className="relative min-h-0 flex-1">
        {selection && (
          <div className="pop-in absolute top-1 left-1/2 z-10 -translate-x-1/2">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyToSelection(selectionCut ? "restore" : "cut")}
              className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-neutral-700"
            >
              {selectionCut ? <ArrowCounterClockwiseIcon size={14} /> : <ScissorsIcon size={14} />}
              {selectionCut ? "Restore" : "Cut"} {selection.to - selection.from + 1} word{selection.to === selection.from ? "" : "s"}
            </button>
          </div>
        )}
        <div
          ref={rootRef}
          onMouseUp={readSelection}
          onKeyUp={readSelection}
          className="h-full overflow-y-auto px-4 pb-4 text-[15px] leading-8 text-neutral-800"
        >
          {words.map((word, index) => {
            const isCut = isWordCut(cuts, word)
            const isNow = currentTime >= word.start && currentTime < word.end
            return (
              <span key={`${word.start}-${index}`}>
                <span
                  data-word={index}
                  onClick={() => window.getSelection()?.isCollapsed !== false && onSeek(word.start)}
                  className={`cursor-text rounded px-0.5 transition-colors ${
                    isCut
                      ? "text-neutral-400 line-through decoration-red-500 decoration-2"
                      : isNow
                        ? "bg-amber-200"
                        : "hover:bg-neutral-100"
                  }`}
                >
                  {word.text}
                </span>{" "}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ToolButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  )
}
