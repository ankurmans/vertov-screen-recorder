// Recording length: the server boundary, the client guard, and the timeline of a six-hour take.
// Run: npx tsx scripts/test-recording-limit.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import {
  AUTO_STOP_PARTS,
  AUTO_STOP_SECONDS,
  MAX_PARTS,
  MAX_RECORDING_SECONDS,
  WARN_REMAINING_SECONDS,
  completeSchema,
  crossedWarning,
  limitState,
  reportedDuration,
  warningText,
} from "../src/lib/recording-limit.ts"
import * as extension from "../extension/lib/recording-limit.js"

let passed = 0
const test = (name, fn) => {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const body = (duration, extra = {}) => ({ duration, partCount: 3, ...extra })

test("server boundary: six hours exactly is accepted, anything longer is refused", () => {
  assert.equal(MAX_RECORDING_SECONDS, 21_600)
  assert.equal(completeSchema.safeParse(body(21_600)).success, true)
  assert.equal(completeSchema.safeParse(body(21_599.999)).success, true)
  assert.equal(completeSchema.safeParse(body(21_600.001)).success, false, "one millisecond over is refused")
  assert.equal(completeSchema.safeParse(body(24 * 3600)).success, false)
  assert.equal(completeSchema.safeParse(body(-1)).success, false)
  assert.equal(completeSchema.safeParse(body(Number.POSITIVE_INFINITY)).success, false)
})

test("server boundary: part count 10,000 is accepted, 10,001 is refused (R2 multipart ceiling)", () => {
  assert.equal(completeSchema.safeParse(body(60, { partCount: MAX_PARTS })).success, true)
  assert.equal(completeSchema.safeParse(body(60, { partCount: MAX_PARTS + 1 })).success, false)
  assert.equal(completeSchema.safeParse(body(60, { partCount: 0 })).success, false)
  // 5 MiB parts: the ceiling is about 52 GB per track, so six hours only needs more than roughly 19 Mbit/s to reach it.
  const bytes = MAX_PARTS * 5 * 1024 * 1024
  const mbit = (bytes * 8) / MAX_RECORDING_SECONDS / 1e6
  assert.ok(mbit > 19 && mbit < 20, `part ceiling is reached at ${mbit.toFixed(1)} Mbit/s over six hours`)
})

test("the client stops itself before the server limit, with room for a throttled timer", () => {
  assert.ok(AUTO_STOP_SECONDS < MAX_RECORDING_SECONDS)
  assert.ok(MAX_RECORDING_SECONDS - AUTO_STOP_SECONDS >= 120, "at least two minutes of margin")
  assert.equal(limitState(AUTO_STOP_SECONDS - 1).stop, false)
  assert.equal(limitState(AUTO_STOP_SECONDS).stop, true)
  assert.equal(limitState(AUTO_STOP_SECONDS + 5000).remaining, 0)
  assert.equal(limitState(10, AUTO_STOP_PARTS - 1).stop, false)
  assert.equal(limitState(10, AUTO_STOP_PARTS).stop, true, "stops a little short of the 10,000-part ceiling")
})

test("timeline: whichever way the clock is checked, the reported length is never refused", () => {
  // Check intervals: a pip window (0.15 s), a visible tab (1 s), a data event (1 s), and a hidden tab throttled to once a minute.
  for (const interval of [0.15, 1, 60, 61]) {
    for (const offset of [0, 0.37, interval / 2]) {
      let t = offset
      while (!limitState(t).stop) t += interval
      const finishedAt = t // stop() reads the clock here
      const duration = reportedDuration(finishedAt)
      assert.ok(duration <= MAX_RECORDING_SECONDS)
      assert.equal(completeSchema.safeParse(body(duration)).success, true, `interval ${interval}s, offset ${offset}s: ${finishedAt}s accepted`)
      assert.ok(finishedAt <= AUTO_STOP_SECONDS + interval + 1e-9)
    }
  }
})

test("a clock that overshoots still finishes: the reported length is clamped, never refused", () => {
  assert.equal(reportedDuration(21_600.4), 21_600)
  assert.equal(reportedDuration(99_999), 21_600)
  assert.equal(reportedDuration(Number.NaN), 0)
  assert.equal(reportedDuration(-5), 0)
  assert.equal(completeSchema.safeParse(body(reportedDuration(99_999))).success, true)
})

test("advance warnings: 30, 10, 5 and 1 minute before the automatic stop, each once", () => {
  assert.deepEqual([...WARN_REMAINING_SECONDS], [1800, 600, 300, 60])
  const fired = []
  let previous = 0
  for (let t = 1; t <= AUTO_STOP_SECONDS + 5; t += 1) {
    const warned = crossedWarning(previous, t)
    if (warned !== null) fired.push([warned, t])
    previous = t
  }
  assert.deepEqual(fired, [
    [1800, AUTO_STOP_SECONDS - 1800],
    [600, AUTO_STOP_SECONDS - 600],
    [300, AUTO_STOP_SECONDS - 300],
    [60, AUTO_STOP_SECONDS - 60],
  ])
  // A throttled tab that wakes once a minute still gets each warning exactly once.
  const throttled = []
  previous = 0
  for (let t = 59; t <= AUTO_STOP_SECONDS; t += 59) {
    const warned = crossedWarning(previous, t)
    if (warned !== null) throttled.push(warned)
    previous = t
  }
  assert.deepEqual(throttled.length, new Set(throttled).size)
  assert.equal(limitState(AUTO_STOP_SECONDS - 29 * 60).level, "notice")
  assert.equal(limitState(AUTO_STOP_SECONDS - 4 * 60).level, "soon")
  assert.equal(limitState(10).level, "ok")
  assert.match(warningText(1800), /30 minutes/)
  assert.match(warningText(30), /less than a minute/)
})

test("the extension carries the same numbers and behaviour as the app", () => {
  assert.equal(extension.MAX_RECORDING_SECONDS, MAX_RECORDING_SECONDS)
  assert.equal(extension.AUTO_STOP_SECONDS, AUTO_STOP_SECONDS)
  assert.equal(extension.AUTO_STOP_PARTS, AUTO_STOP_PARTS)
  for (const seconds of [0, 100, AUTO_STOP_SECONDS - 1800, AUTO_STOP_SECONDS - 300, AUTO_STOP_SECONDS, 30_000]) {
    assert.deepEqual(extension.limitState(seconds, 5), limitState(seconds, 5))
  }
  for (const seconds of [-1, 0, 123.4, 21_600, 40_000]) assert.equal(extension.reportedDuration(seconds), reportedDuration(seconds))
  assert.equal(extension.warningText(600), warningText(600))
})

test("both recorders and the completion route use the guard", () => {
  const web = fs.readFileSync("src/components/recorder.tsx", "utf8")
  assert.match(web, /limitState\(seconds, parts\)\.stop/)
  assert.match(web, /reportedDuration\(secondsRecorded\(current\)\)/)
  assert.match(web, /addEventListener\("dataavailable"/, "the data event checks the limit, since hidden-tab timers are throttled")
  assert.match(web, /take\.seconds > MAX_RECORDING_SECONDS/, "a saved take that is too long is kept for download, not uploaded to fail")
  const extensionOffscreen = fs.readFileSync("extension/offscreen.js", "utf8")
  assert.match(extensionOffscreen, /limit\.stop/)
  assert.match(extensionOffscreen, /reportedDuration\(/)
  assert.match(extensionOffscreen, /addEventListener\("dataavailable"/)
  const route = fs.readFileSync("src/routes/api/recordings.$id.complete.ts", "utf8")
  assert.match(route, /completeSchema/)
  assert.match(route, /code: "too_long"/)
  assert.match(route, /422/)
  assert.doesNotMatch(route, /abort\(\)[^]*too_long/, "a too-long completion does not abort the stored parts")
})

console.log(`\n${passed} test groups passed`)
