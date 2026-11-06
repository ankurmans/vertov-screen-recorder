// Mirrors src/lib/recording-limit.ts (the app's copy). scripts/test-tools.mjs fails if the numbers drift apart.
export const MAX_RECORDING_SECONDS = 6 * 60 * 60
export const AUTO_STOP_SECONDS = MAX_RECORDING_SECONDS - 120
export const AUTO_STOP_PARTS = 10_000 - 100

export function limitState(elapsedSeconds, parts = 0) {
  const byTime = AUTO_STOP_SECONDS - elapsedSeconds
  const stop = byTime <= 0 || parts >= AUTO_STOP_PARTS
  const remaining = Math.max(0, byTime)
  const level = stop ? "now" : remaining <= 5 * 60 ? "soon" : remaining <= 30 * 60 ? "notice" : "ok"
  return { remaining, level, stop }
}

export function reportedDuration(seconds) {
  return Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), MAX_RECORDING_SECONDS)
}

export function warningText(remainingSeconds) {
  const minutes = Math.ceil(remainingSeconds / 60)
  const left = remainingSeconds <= 60 ? "less than a minute" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  return `Recording stops and saves by itself in ${left}. Recordings are limited to six hours.`
}
