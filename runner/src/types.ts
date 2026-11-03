import type { Recipe } from "../../src/lib/tutorials/recipe"

/** Contracts between the runner's modules: narration -> execution -> production -> upload. */

/** Narration for one step, ready before the browser starts so the footage can be paced to it. */
export interface StepNarration {
  stepId: string
  text: string
  /** Absolute path to an audio file (mp3/wav), or null when this run has no audio (screen-only). */
  audioPath: string | null
  /** Real audio length when synthesised or supplied; otherwise the estimate at the target pace. */
  seconds: number
}

export interface NarrationPlan {
  steps: Array<StepNarration>
  voice: string
  /** true when the audio came from a speech provider or an approved file; false for silence/estimates. */
  synthesized: boolean
  /** Words per minute over the whole script, measured against `seconds`. */
  wpm: number
}

export interface StepResult {
  stepId: string
  /** Milliseconds from the start of the recording to the moment this step's first action began. */
  startMs: number
  /** When the step's last action and expectations finished. */
  actionsEndMs: number
  /** When the next step may begin (narration finished and the hold elapsed). */
  endMs: number
  /** Every expectation of the step was checked and held. A step with no expectations is never verified. */
  verified: boolean
  note?: string
}

export interface ClickPoint {
  /** Milliseconds from the start of the recording. */
  tMs: number
  /** Fractions of the recorded picture, 0..1. */
  x: number
  y: number
}

export interface ExecutionResult {
  /** The raw browser recording (WebM) at 1920x1080. */
  videoPath: string
  width: number
  height: number
  durationMs: number
  steps: Array<StepResult>
  clicks: Array<ClickPoint>
}

export interface ProducedVideo {
  /** Final 1920x1080 H.264/AAC MP4. */
  path: string
  durationSeconds: number
  /** Narration cues timed against the final audio. */
  cues: Array<{ start: number; end: number; text: string }>
  /** Zoom points (see src/lib/zooms.ts ZoomPoint) derived from clicks. */
  zooms: Array<{ id: string; start: number; duration: number; x: number; y: number; scale: number }>
}

export interface RunnerLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export type ProgressFn = (progress: { stage: "preparing" | "recording" | "verifying" | "narrating" | "producing" | "uploading"; step?: string; message?: string; percent?: number }) => Promise<{ cancel: boolean }>

export type { Recipe }
