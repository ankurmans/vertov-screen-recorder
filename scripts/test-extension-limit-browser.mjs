// Loads the REAL extension code into a real Chrome and lets it record against a LOCAL worker until its automatic stop.
// The test copy differs from extension/ in exactly two ways, both listed here so the result is read correctly:
//   1. manifest.json: host_permissions also allow http://localhost/* (the packaged extension only reaches vertov.app).
//   2. lib/recording-limit.js: the six-hour numbers are scaled down (limit 60 s, automatic stop at 50 s, "notice" at 25 s
//      remaining and "soon" at 10 s) so the run takes about a minute. The logic is the shipped logic.
// The source is the camera (Chrome's fake device), so no screen or microphone permission prompt is involved.
// Start the worker first (see test-recorder-limit-browser.mjs). Run: BASE=http://localhost:8816 node scripts/test-extension-limit-browser.mjs
import { createRequire } from "node:module"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const BASE = process.env.BASE ?? "http://localhost:8816"
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("Local worker only.")
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/private/tmp/vertov-browser-test/node_modules/playwright-core")

const work = fs.mkdtempSync(path.join(os.tmpdir(), "vertov-ext-limit-"))
const extensionDir = path.join(work, "extension")
fs.cpSync("extension", extensionDir, { recursive: true })
const manifestPath = path.join(extensionDir, "manifest.json")
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
manifest.host_permissions = [...manifest.host_permissions, "http://localhost/*"]
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
const limitPath = path.join(extensionDir, "lib/recording-limit.js")
let limitSource = fs.readFileSync(limitPath, "utf8")
const before = limitSource
limitSource = limitSource
  .replace("export const MAX_RECORDING_SECONDS = 6 * 60 * 60", "export const MAX_RECORDING_SECONDS = 60")
  .replace("MAX_RECORDING_SECONDS - 120", "MAX_RECORDING_SECONDS - 10")
  .replace("remaining <= 5 * 60", "remaining <= 10")
  .replace("remaining <= 30 * 60", "remaining <= 25")
assert.notEqual(limitSource, before)
assert.match(limitSource, /MAX_RECORDING_SECONDS = 60/)
assert.match(limitSource, /remaining <= 10/)
fs.writeFileSync(limitPath, limitSource)

const anon = await fetch(`${BASE}/api/auth/sign-in/anonymous`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: "{}" })
const cookie = (anon.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ")
assert.ok(cookie, "guest session on the local worker")
const key = (await (await fetch(`${BASE}/api/keys`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: BASE }, body: JSON.stringify({ name: "ext-limit-test" }) })).json()).token
assert.match(key, /^rk_/)

// Chrome 137 and later ignore --load-extension, so the unpacked folder is loaded through the DevTools "Extensions" domain instead.
// Chrome 137 and later ignore --load-extension, so the unpacked folder is loaded through the DevTools "Extensions" domain,
// which only answers over --remote-debugging-pipe. A debugging port is opened too so Playwright can drive the same Chrome.
const { spawn } = await import("node:child_process")
const PORT = 9333
const chrome = spawn(
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    `--user-data-dir=${path.join(work, "profile")}`, "--no-first-run", "--no-default-browser-check", "--headless=new",
    "--remote-debugging-pipe", `--remote-debugging-port=${PORT}`, "--enable-unsafe-extension-debugging",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
)
const loadUnpacked = () =>
  new Promise((resolve, reject) => {
    let buffer = ""
    const timer = setTimeout(() => reject(new Error("Extensions.loadUnpacked did not answer")), 20000)
    chrome.stdio[4].on("data", (chunk) => {
      buffer += chunk.toString()
      for (const part of buffer.split("\0")) {
        if (!part.trim().startsWith("{")) continue
        try {
          const message = JSON.parse(part)
          if (message.id === 1) { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result) }
        } catch { /* partial message */ }
      }
    })
    chrome.stdio[3].write(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: extensionDir } }) + "\0")
  })
const context = await (async () => {
  for (let i = 0; i < 40; i++) {
    try { return (await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)).contexts()[0] } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  throw new Error("Chrome did not start")
})()
const log = []
const note = (name, value) => {
  log.push({ name, value })
  console.log(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
}
try {
  const workerReady = context.waitForEvent("serviceworker", { timeout: 20000 })
  const loaded = await loadUnpacked()
  note("Extensions.loadUnpacked", { id: String(loaded.id).slice(0, 6) + "…" })
  await workerReady.catch(() => {})
  const extensionId = loaded.id
  let worker = null
  for (let i = 0; i < 40 && !worker; i++) {
    worker = context.serviceWorkers().find((w) => new URL(w.url()).host === extensionId) ?? null
    if (!worker) await new Promise((r) => setTimeout(r, 500))
  }
  assert.ok(worker, `the extension's service worker is running (workers: ${context.serviceWorkers().map((w) => w.url()).join(", ")})`)
  note("extension loaded", { id: extensionId.slice(0, 6) + "…", version: manifest.version })

  await worker.evaluate(({ server, token }) => chrome.storage.local.set({ server, token }), { server: BASE, token: key })

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  const startedAt = Date.now()
  const started = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "start", options: { mode: "camera", camera: true, mic: false, captureClicks: false, size: "auto" } }))
  note("start reply", { ok: started?.ok, error: started?.error, hasUrl: Boolean(started?.url) })
  assert.equal(started?.ok, true, `the extension started a recording: ${started?.error}`)

  if (process.env.SCENARIO === "revoked-key") {
    // Failure path, not the limit: the key is revoked mid-recording, so finalisation is refused. What is left of the recording?
    const second = (await (await fetch(`${BASE}/api/keys`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: BASE }, body: JSON.stringify({ name: "ext-check" }) })).json())
    const keys = (await (await fetch(`${BASE}/api/keys`, { headers: { cookie, origin: BASE } })).json()).keys
    const first = keys.find((k) => k.name === "ext-limit-test")
    await new Promise((r) => setTimeout(r, 8000))
    await fetch(`${BASE}/api/keys`, { method: "DELETE", headers: { "content-type": "application/json", cookie, origin: BASE }, body: JSON.stringify({ id: first.id }) })
    const tabsBefore = context.pages().length
    const stopped = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "stop" }))
    note("stop reply after the key was revoked", stopped)
    await new Promise((r) => setTimeout(r, 3000))
    note("tabs opened by the extension", context.pages().slice(tabsBefore).map((p) => p.url().replace(BASE, "")))
    const state = await worker.evaluate(() => chrome.storage.session.get("recording"))
    note("extension state after the failure", state)
    const id = started.url.match(/\/([0-9a-f]{8})$/)?.[1]
    const rpc = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${second.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_video", arguments: { video: id } } }) })
    note("what the server holds for that recording", ((await rpc.json()).result?.content?.[0]?.text ?? "").slice(0, 200))
    console.log("\nextension failure scenario finished (informational)")
    throw Object.assign(new Error("scenario done"), { scenarioDone: true })
  }

  const badge = async () => ({ text: await worker.evaluate(() => chrome.action.getBadgeText({})), colour: await worker.evaluate(() => chrome.action.getBadgeBackgroundColor({})) })
  const seen = []
  const opened = []
  context.on("page", (page) => page.on("framenavigated", (frame) => frame === page.mainFrame() && opened.push(frame.url())))
  let finishedUrl = null
  while (Date.now() - startedAt < 90_000) {
    const now = await badge()
    const rgb = now.colour.join(",")
    const sample = `${now.text}|${rgb}`
    if (!seen.some((s) => s.sample === sample)) seen.push({ sample, at: Math.round((Date.now() - startedAt) / 1000) })
    finishedUrl = context.pages().map((p) => p.url()).find((u) => /\?new=1/.test(u)) ?? opened.find((u) => /\?new=1/.test(u)) ?? null
    if (finishedUrl) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  note("badge over time (text|rgb, seconds since start)", seen.slice(0, 14))
  note("share page opened", finishedUrl)
  assert.ok(finishedUrl, "the extension stopped by itself and opened the share page")
  assert.match(finishedUrl, /\?new=1&limit=1/, "the share page was opened with the limit flag")
  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  assert.ok(elapsed >= 45 && elapsed <= 75, `it stopped at about the automatic stop (${elapsed}s)`)

  const colours = seen.map((s) => s.sample.split("|")[1])
  assert.ok(colours.some((c) => c === "217,119,6,255"), "badge turned amber (notice) before the stop")
  assert.ok(colours.some((c) => c === "127,29,29,255"), "badge turned dark red (soon) before the stop")

  const id = finishedUrl.match(/\/([0-9a-f]{8})\?/)?.[1]
  assert.ok(id, "the recording id is in the share URL")
  const rpc = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_video", arguments: { video: id } } }) })
  const video = JSON.parse((await rpc.json()).result.content[0].text)
  note("stored recording", { status: video.status, duration: video.duration })
  assert.equal(video.status, "ready", "the recording was finalised and kept")
  assert.ok(video.duration >= 40 && video.duration <= 60, `stored duration ${video.duration}s is within the (scaled) limit`)
} catch (error) {
  if (!error.scenarioDone) throw error
} finally {
  const exited = new Promise((resolve) => chrome.once("exit", resolve))
  chrome.kill()
  await exited
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 })
}
if (!process.env.SCENARIO) console.log("\nextension limit test passed")
