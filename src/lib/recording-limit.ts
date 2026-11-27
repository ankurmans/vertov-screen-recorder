import { z } from "zod"

/** The server rejects a completion that reports a longer recording. Do not raise it without checking storage, transcription and export. */
export const MAX_RECORDING_SECONDS = 6 * 60 * 60

/**
 * The most a single recording (screen and camera tracks together) may upload: six hours at the library's rate (plans.ts
 * BYTES_PER_HOUR, 1 GB an hour; copied here because the public edition has no plans.ts, and scripts/test-recording-quota.mjs
 * checks the two agree), times a headroom of 4: 24 GB, an average of about 8.9 Mbit/s over six hours, against the 3.5 Mbit/s of
 * the web recorder and up to 24 Mbit/s for a very large screen in the extension. A part that would take it past this is
 * refused, so an upload can't grow without limit while its row still counts as nothing in the library.
 */
export const LIBRARY_BYTES_PER_HOUR = 1_000_000_000
export const RECORDING_BYTES_HEADROOM = 4
export const MAX_RECORDING_BYTES = (MAX_RECORDING_SECONDS / 3600) * LIBRARY_BYTES_PER_HOUR * RECORDING_BYTES_HEADROOM

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
  /** What ends the recording: the plan's length rule, or the six-hour server limit (also the part ceiling). */
  by: "cap" | "limit"
}

/**
 * A plan's length rule in seconds, or null when the recorder only has the six-hour limit. `enforce` false means the
 * recording is one of the free courtesy ones that run on past the rule and save whole, so nothing counts down.
 */
export function enforcedCap(capSeconds: number | null | undefined, enforce = true): number | null {
  return capSeconds != null && capSeconds > 0 && capSeconds < AUTO_STOP_SECONDS && enforce ? capSeconds : null
}

/** `cap` is the length rule from enforcedCap(): the recorder counts down to it and stops there, saved, instead of at six hours. */
export function limitState(elapsedSeconds: number, parts = 0, cap: number | null = null): LimitState {
  const end = cap != null ? Math.min(cap, AUTO_STOP_SECONDS) : AUTO_STOP_SECONDS
  const byTime = end - elapsedSeconds
  const stop = byTime <= 0 || parts >= AUTO_STOP_PARTS
  const remaining = Math.max(0, byTime)
  const level: LimitLevel = stop ? "now" : remaining <= 5 * 60 ? "soon" : remaining <= 30 * 60 ? "notice" : "ok"
  return { remaining, level, stop, by: cap != null && byTime <= 0 ? "cap" : "limit" }
}

/** The advance warning to announce now, or null. `last` is the previous elapsed value, so each threshold fires once. */
export function crossedWarning(previousElapsed: number, elapsed: number, cap: number | null = null): number | null {
  const end = cap != null ? Math.min(cap, AUTO_STOP_SECONDS) : AUTO_STOP_SECONDS
  const before = end - previousElapsed
  const after = end - elapsed
  for (const threshold of WARN_REMAINING_SECONDS) if (before > threshold && after <= threshold) return threshold
  return null
}

/** True the moment a recording that is allowed to run on first passes the plan's length rule. */
export function passedCap(previousElapsed: number, elapsed: number, capSeconds: number | null | undefined): boolean {
  return capSeconds != null && capSeconds > 0 && previousElapsed < capSeconds && elapsed >= capSeconds
}

const minutesText = (seconds: number) => {
  const minutes = Math.round(seconds / 60)
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

export function warningText(remainingSeconds: number, cap: number | null = null): string {
  const minutes = Math.ceil(remainingSeconds / 60)
  const left = remainingSeconds <= 60 ? "less than a minute" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  return cap != null
    ? `Recording stops and saves by itself in ${left}. Free recordings are limited to ${minutesText(cap)}.`
    : `Recording stops and saves by itself in ${left}. Recordings are limited to six hours.`
}

/** Shown once when a courtesy recording passes the rule it is allowed to run past. */
export function courtesyText(capSeconds: number): string {
  return `You're past ${minutesText(capSeconds)}. Free recordings usually stop here, but this one keeps going and saves whole.`
}

/** What the recorder shows beside the clock when it counts down to a length rule: "14:32 left". */
export function capClock(remainingSeconds: number): string {
  const total = Math.max(0, Math.ceil(remainingSeconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} left`
}

/** Whether a finished recording ran on past the plan's length rule, with a few seconds of tolerance for a throttled timer. */
export function ranLong(durationSeconds: number, capSeconds: number | null | undefined): boolean {
  return capSeconds != null && capSeconds > 0 && durationSeconds > capSeconds + 5
}

/** Whether it ended at the rule or past it: the recordings that get the upgrade card afterwards. */
export function reachedCap(durationSeconds: number, capSeconds: number | null | undefined): boolean {
  return capSeconds != null && capSeconds > 0 && durationSeconds >= capSeconds - 3
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
