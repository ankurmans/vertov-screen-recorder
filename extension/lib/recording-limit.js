// Mirrors src/lib/recording-limit.ts (the app's copy). scripts/test-tools.mjs fails if the numbers drift apart.
export const MAX_RECORDING_SECONDS = 6 * 60 * 60
export const AUTO_STOP_SECONDS = MAX_RECORDING_SECONDS - 120
export const AUTO_STOP_PARTS = 10_000 - 100

export const WARN_REMAINING_SECONDS = [30 * 60, 10 * 60, 5 * 60, 60]

export function enforcedCap(capSeconds, enforce = true) {
  return capSeconds != null && capSeconds > 0 && capSeconds < AUTO_STOP_SECONDS && enforce ? capSeconds : null
}

export function limitState(elapsedSeconds, parts = 0, cap = null) {
  const end = cap != null ? Math.min(cap, AUTO_STOP_SECONDS) : AUTO_STOP_SECONDS
  const byTime = end - elapsedSeconds
  const stop = byTime <= 0 || parts >= AUTO_STOP_PARTS
  const remaining = Math.max(0, byTime)
  const level = stop ? "now" : remaining <= 5 * 60 ? "soon" : remaining <= 30 * 60 ? "notice" : "ok"
  return { remaining, level, stop, by: cap != null && byTime <= 0 ? "cap" : "limit" }
}

export function crossedWarning(previousElapsed, elapsed, cap = null) {
  const end = cap != null ? Math.min(cap, AUTO_STOP_SECONDS) : AUTO_STOP_SECONDS
  const before = end - previousElapsed
  const after = end - elapsed
  for (const threshold of WARN_REMAINING_SECONDS) if (before > threshold && after <= threshold) return threshold
  return null
}

export function passedCap(previousElapsed, elapsed, capSeconds) {
  return capSeconds != null && capSeconds > 0 && previousElapsed < capSeconds && elapsed >= capSeconds
}

export function ranLong(durationSeconds, capSeconds) {
  return capSeconds != null && capSeconds > 0 && durationSeconds > capSeconds + 5
}

export function reachedCap(durationSeconds, capSeconds) {
  return capSeconds != null && capSeconds > 0 && durationSeconds >= capSeconds - 3
}

export function reportedDuration(seconds) {
  return Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), MAX_RECORDING_SECONDS)
}

const minutesText = (seconds) => {
  const minutes = Math.round(seconds / 60)
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

export function warningText(remainingSeconds, cap = null) {
  const minutes = Math.ceil(remainingSeconds / 60)
  const left = remainingSeconds <= 60 ? "less than a minute" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  return cap != null
    ? `Recording stops and saves by itself in ${left}. Free recordings are limited to ${minutesText(cap)}.`
    : `Recording stops and saves by itself in ${left}. Recordings are limited to six hours.`
}

export function courtesyText(capSeconds) {
  return `You're past ${minutesText(capSeconds)}. Free recordings usually stop here, but this one keeps going and saves whole.`
}

export function capClock(remainingSeconds) {
  const total = Math.max(0, Math.ceil(remainingSeconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} left`
}
