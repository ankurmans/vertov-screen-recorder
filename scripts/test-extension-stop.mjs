// The extension must never record without showing it. Runs the real service worker and recorder against a fake Chrome:
// stop pressed again while a slow upload is in flight, start pressed again while a slow start is in flight, and a
// recording that ends by itself. Run: npx tsx scripts/test-extension-stop.mjs
import assert from "node:assert/strict"

const tick = () => new Promise((resolve) => setImmediate(resolve))
const settle = async () => { for (let i = 0; i < 40; i++) await tick() }

// --- fake browser ---

const listeners = []
let shortcut = null
const session = {}
const opened = []
let badge = ""

const nothing = () => new Proxy(function () {}, {
  get: (_, key) => (key === "then" ? undefined : key === "addListener" || key === "removeListener" ? () => {} : nothing()),
  apply: () => Promise.resolve([]),
})
const namespace = (known) => new Proxy(known, { get: (target, key) => (key in target ? target[key] : nothing()) })

globalThis.chrome = namespace({
  runtime: namespace({
    onMessage: { addListener: (fn) => listeners.push(fn) },
    sendMessage: (message) => new Promise((resolve) => {
      let waiting = false
      for (const listener of listeners) if (listener(message, {}, resolve) === true) waiting = true
      if (!waiting) resolve(undefined)
    }),
    getContexts: async () => [{}],
  }),
  storage: namespace({
    session: { get: async (key) => ({ [key]: session[key] }), set: async (values) => void Object.assign(session, structuredClone(values)) },
    local: namespace({ get: async () => ({ server: "https://test.invalid", token: "test" }), set: async () => {}, remove: async () => {} }),
  }),
  action: namespace({ setBadgeText: async ({ text }) => void (badge = text) }),
  tabs: namespace({ create: async ({ url }) => void opened.push(url), query: async () => [] }),
  tabCapture: { getMediaStreamId: async () => "stream" },
  commands: { onCommand: { addListener: (fn) => (shortcut = fn) } },
})

const track = () => ({ getSettings: () => ({ width: 1280, height: 720 }), stop() {}, readyState: "live", ended: [], addEventListener(type, fn) { if (type === "ended") this.ended.push(fn) } })
const streams = []
class FakeStream {
  constructor(tracks = [track()]) { this.tracks = tracks }
  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks }
  getAudioTracks() { return this.tracks }
}
const capture = async () => { const stream = new FakeStream(); streams.push(stream); return stream }
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: capture, getDisplayMedia: capture } } })
globalThis.MediaStream = FakeStream
const recorders = []
globalThis.MediaRecorder = class {
  static isTypeSupported() { return true }
  state = "inactive"
  mimeType = "video/webm"
  stopped = []
  constructor(_stream, options) { this.video = "videoBitsPerSecond" in options; recorders.push(this) }
  start() { this.state = "recording" }
  stop() { this.state = "inactive"; setImmediate(() => this.stopped.forEach((fn) => fn())) }
  addEventListener(type, fn) { if (type === "stop") this.stopped.push(fn) }
}
const node = { connect() {} }
globalThis.AudioContext = class {
  destination = {}
  async resume() {}
  async close() {}
  createMediaStreamSource() { return node }
  createMediaStreamDestination() { return { stream: new FakeStream() } }
  createGain() { return node }
}
globalThis.document = { getElementById: () => ({ select() {} }), execCommand() {} }
const realTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...rest) => (ms >= 3000 ? 0 : realTimeout(fn, ms, ...rest)) // posters are not under test
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

// --- fake server, with the create and finish requests held until the test lets them go ---

let created = 0
const held = { create: [], complete: [] }
const requests = []
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname
  requests.push(`${init.method ?? "GET"} ${path}`)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
  if (path === "/api/recordings" && init.method === "POST") {
    const id = `rec${++created}`
    await new Promise((resolve) => held.create.push(resolve))
    return json({ id, url: `https://test.invalid/${id}` }, 201)
  }
  if (path.endsWith("/complete")) await new Promise((resolve) => held.complete.push(resolve))
  return json({ ok: true })
}
const release = async (kind) => { held[kind].splice(0).forEach((resolve) => resolve()); await settle() }

await import("../extension/offscreen.js")
await import("../extension/background.js")
await settle()

const tab = { id: 1, url: "https://example.com/" }
const press = async () => { void shortcut("toggle-recording", tab); await settle() }
const ask = (type) => chrome.runtime.sendMessage({ type })
const recording = () => recorders.filter((recorder) => recorder.video && recorder.state === "recording").length
const posts = () => requests.filter((request) => request === "POST /api/recordings").length
/** Whatever is being recorded is what the toolbar says is being recorded. */
const visible = (when) => {
  if (recording() > 0) assert.ok(session.recording && !session.recording.saving, `${when}: recording with nothing to show it`)
}

// 1. Start pressed twice while the server is slow to answer.
await press()
await press()
await release("create")
assert.equal(posts(), 1, "a second start during a slow start made another recording")
assert.equal(recording(), 1)
visible("after a double start")

// 2. Stop, then stop again while the upload is slow, then again.
await press()
assert.equal(recording(), 0)
assert.equal(session.recording?.saving, true, "the state does not say it is saving")
await press()
await press()
await release("create")
visible("after pressing again during a save")
assert.equal(posts(), 1, "a press during a save started a recording")
assert.equal((await ask("discard")).ok, true)
assert.ok(session.recording, "discard during a save dropped the state")
assert.deepEqual(opened, [], "a repeated stop opened the unfinished recording")
await release("complete")
assert.equal(session.recording ?? null, null)
assert.equal(badge, "")
assert.equal(opened.length, 1, "the finished recording opens once")
assert.ok(!requests.some((request) => request.startsWith("DELETE ")), "a recording being saved was deleted")

// 3. The next recording works, ends by itself (the tab closes), and a stop press during that save changes nothing.
await press()
await release("create")
assert.equal(recording(), 1)
visible("a new recording after a save")
streams.forEach((stream) => stream.getTracks()[0].ended.forEach((fn) => fn()))
await settle()
assert.equal(recording(), 0)
await press()
assert.ok(session.recording, "a stop press while it saved itself cleared the state")
assert.equal(opened.length, 1)
await release("complete")
assert.equal(session.recording ?? null, null)
assert.equal(opened.length, 2)
assert.equal(posts(), 2)

// 4. A late result for an earlier recording leaves the current one alone.
await press()
await release("create")
await chrome.runtime.sendMessage({ target: "background", type: "finished", id: "rec1", url: "https://test.invalid/rec1" })
await chrome.runtime.sendMessage({ target: "background", type: "failed", id: "rec2", error: "late" })
await settle()
assert.equal(session.recording?.id, "rec3", "an earlier recording's result cleared the current one")
visible("after a late result")

console.log("extension stop and start: ok")
process.exit(0)
