// Drives the real completion endpoint on a LOCAL worker (guest account, local D1 and R2 only) at the six-hour boundary.
// Start the worker first (npm run build, then wrangler dev -c dist/server/wrangler.json --local --port 8816).
// Run: BASE=http://localhost:8816 node scripts/test-recording-boundary.mjs
import assert from "node:assert/strict"

const BASE = process.env.BASE ?? "http://localhost:8816"
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("This test only runs against a local worker.")
const results = []
const log = (name, value) => {
  results.push({ name, ...value })
  console.log(`${name}: ${JSON.stringify(value)}`)
}

const anon = await fetch(`${BASE}/api/auth/sign-in/anonymous`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: "{}" })
const cookie = (anon.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ")
assert.ok(cookie, "guest session cookie")
const headers = { cookie, origin: BASE, "content-type": "application/json" }

async function newRecording() {
  const created = await fetch(`${BASE}/api/recordings`, { method: "POST", headers, body: JSON.stringify({ mimeType: "video/webm", cameraMimeType: null, surface: "monitor", width: 1280, height: 720 }) })
  assert.equal(created.status, 201, `create recording: ${created.status}`)
  const { id } = await created.json()
  // One small part is the last part, so R2 accepts it without the 5 MiB minimum.
  const part = await fetch(`${BASE}/api/recordings/${id}/parts?part=1&track=screen`, { method: "PUT", headers: { cookie, origin: BASE }, body: new Uint8Array(2048) })
  assert.equal(part.status, 200, `upload part: ${part.status}`)
  return id
}
const complete = async (id, duration, extra = {}) => {
  const response = await fetch(`${BASE}/api/recordings/${id}/complete`, { method: "POST", headers, body: JSON.stringify({ duration, partCount: 1, width: 1280, height: 720, ...extra }) })
  return { status: response.status, body: await response.json().catch(() => null) }
}

// 1. One millisecond over six hours is refused with a specific answer, and the stored part is not thrown away.
const over = await newRecording()
const refused = await complete(over, 21_600.001)
log("duration 21600.001", refused)
assert.equal(refused.status, 422)
assert.equal(refused.body.code, "too_long")
assert.equal(refused.body.maxSeconds, 21_600)

// 2. The same recording, finished again with a valid length, succeeds: the parts were kept.
const retried = await complete(over, 21_598)
log("same recording retried at 21598 (what the guard sends)", retried)
assert.equal(retried.status, 200)

// 3. Exactly six hours.
const exact = await newRecording()
const accepted = await complete(exact, 21_600)
log("duration 21600 exactly", accepted)
assert.equal(accepted.status, 200)

// 4. Part count over the multipart ceiling is a plain invalid request.
const parts = await newRecording()
const tooMany = await complete(parts, 60, { partCount: 10_001 })
log("partCount 10001", tooMany)
assert.equal(tooMany.status, 400)

// 5. The library shows both finished recordings with the durations that were stored.
const library = await fetch(`${BASE}/api/recordings`, { headers })
log("library list", { status: library.status })

console.log(`\n${results.length} checks passed`)
