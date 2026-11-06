import { z } from "zod"

/** The server rejects a completion that reports a longer recording. Do not raise it without checking storage, transcription and export. */
export const MAX_RECORDING_SECONDS = 6 * 60 * 60

/**
 * The recorder finishes by itself this long before the server limit. Chrome can run a hidden tab's timers only
 * once a minute, and the duration is read when stop runs, so the margin has to cover a throttled tick plus the
 * time the last parts take to upload. reportedDuration() still clamps, so a late tick cannot make a finished upload fail.
 */
export const AUTO_STOP_MARGIN_SECONDS = 120
export const AUTO_STOP_SECONDS = MAX_RECORDING_SECONDS - AUTO_STOP_MARGIN_SECONDS

/** Seconds left before the automatic stop at which a warning is shown. */
export const WARN_REMAINING_SECONDS = [30 * 60, 10 * 60, 5 * 60, 60] as const

/**
 * R2 multipart uploads allow 10,000 parts of 5 MiB here, about 52 GB per track. That is reached before six
 * hours only above roughly 19 Mbit/s, so the recorder also stops a little short of the part ceiling.
 */
export const MAX_PARTS = 10_000
export const AUTO_STOP_PARTS = MAX_PARTS - 100

export type LimitLevel = "ok" | "notice" | "soon" | "now"

export interface LimitState {
  /** Seconds until the recorder stops itself. Never negative. */
  remaining: number
  level: LimitLevel
  /** True once the recorder must finish now. */
  stop: boolean
}

export function limitState(elapsedSeconds: number, parts = 0): LimitState {
  const byTime = AUTO_STOP_SECONDS - elapsedSeconds
  const stop = byTime <= 0 || parts >= AUTO_STOP_PARTS
  const remaining = Math.max(0, byTime)
  const level: LimitLevel = stop ? "now" : remaining <= 5 * 60 ? "soon" : remaining <= 30 * 60 ? "notice" : "ok"
  return { remaining, level, stop }
}

/** The advance warning to announce now, or null. `last` is the previous elapsed value, so each threshold fires once. */
export function crossedWarning(previousElapsed: number, elapsed: number): number | null {
  const before = AUTO_STOP_SECONDS - previousElapsed
  const after = AUTO_STOP_SECONDS - elapsed
  for (const threshold of WARN_REMAINING_SECONDS) if (before > threshold && after <= threshold) return threshold
  return null
}

export function warningText(remainingSeconds: number): string {
  const minutes = Math.ceil(remainingSeconds / 60)
  const left = remainingSeconds <= 60 ? "less than a minute" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  return `Recording stops and saves by itself in ${left}. Recordings are limited to six hours.`
}

/** What the client reports as the length: never above the server limit, so a clock oddity cannot make a finished upload fail. */
export function reportedDuration(seconds: number): number {
  return Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), MAX_RECORDING_SECONDS)
}

export const completeSchema = z.object({
  duration: z.number().finite().nonnegative().max(MAX_RECORDING_SECONDS),
  width: z.number().int().positive().max(16384).nullable().optional(),
  height: z.number().int().positive().max(16384).nullable().optional(),
  partCount: z.number().int().min(1).max(MAX_PARTS),
  // 0 or missing: the camera track was dropped and its upload is abandoned.
  cameraPartCount: z.number().int().min(0).max(MAX_PARTS).optional(),
})
