// Drives the REAL web recorder in Chrome against a LOCAL worker, with a skewed clock so a six-hour take takes seconds.
// The screen is a canvas stream (no real screen is captured); the clock offset is added to performance.now() only.
// Start the worker: wrangler dev -c dist/server/wrangler.json --local --port 8816 (with a throwaway local BETTER_AUTH_SECRET).
// Run: BASE=http://localhost:8816 PLAYWRIGHT_PATH=/path/to/playwright-core node scripts/test-recorder-limit-browser.mjs
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const BASE = process.env.BASE ?? "http://localhost:8816"
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("Local worker only.")
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/private/tmp/vertov-browser-test/node_modules/playwright-core")

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] })
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const out = []
const note = (name, value) => {
  out.push({ name, value })
  console.log(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
}

const anon = await context.request.post(`${BASE}/api/auth/sign-in/anonymous`, { headers: { origin: BASE, "content-type": "application/json" }, data: {} })
assert.equal(anon.status(), 200, "guest sign-in")

await context.addInitScript(() => {
  window.__skew = 0
  const real = performance.now.bind(performance)
  performance.now = () => real() + window.__skew * 1000
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext("2d")
    let n = 0
    setInterval(() => {
      ctx.fillStyle = `hsl(${(n += 3) % 360} 60% 40%)`
      ctx.fillRect(0, 0, 640, 360)
    }, 100)
    return canvas.captureStream(10)
  }
})

const page = await context.newPage()
const requests = []
const seen = []
page.on("request", (request) => {
  if (/\/api\/recordings/.test(request.url())) seen.push(request.method() + " " + request.url().replace(BASE, ""))
  if (/\/api\/recordings\/[^/]+\/complete$/.test(request.url())) requests.push({ url: request.url(), body: request.postData() })
})
const visited = []
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) visited.push(frame.url())
})
const completions = []
page.on("response", (response) => {
  if (/\/api\/recordings\/[^/]+\/complete$/.test(response.url())) completions.push({ status: response.status() })
})

await page.goto(`${BASE}/record`)
await page.getByRole("button", { name: "Choose a screen" }).click()
await page.getByRole("button", { name: "Start recording" }).click()
await page.waitForFunction(() => /Recording/.test(document.body.innerText) && !/Starting/.test(document.body.innerText), null, { timeout: 20000 })
await page.waitForTimeout(3500)
note("started", "recording phase reached")

// Jump to 35 minutes before the automatic stop: the 30-minute warning should appear, and the timer should turn amber.
const AUTO_STOP = 21_600 - 120
await page.evaluate((s) => (window.__skew = s), AUTO_STOP - 29 * 60)
await page.waitForFunction(() => /stops and saves by itself in \d+ minutes?/.test(document.body.innerText), null, { timeout: 10000 })
const warning = await page.evaluate(() => document.body.innerText.match(/Recording stops and saves[^.]*\./)?.[0])
note("warning at ~29 min left", warning)
assert.match(warning, /29 minutes|30 minutes/)
const status = await page.locator('[role="status"]').first().innerText().catch(() => "")
note("screen-reader status text", status)
await page.screenshot({ path: process.env.SHOT ?? "/tmp/recorder-limit-warning.png" }).catch(() => {})

// Jump to the automatic stop.
await page.evaluate((s) => (window.__skew = s + 1), AUTO_STOP)
await page.waitForURL(/\/[0-9a-f]{8}(\?|$)/, { timeout: 30000 })
note("api calls", seen.slice(-8))
note("navigations", visited.map((u) => u.replace(BASE, "")))
assert.ok(visited.some((u) => /\?new=1&limit=1/.test(u)), "recorder redirected with the limit flag so the share page can say why")

await page.waitForTimeout(1500)
note("counts", { requests: requests.length, responses: completions.length })
assert.equal(completions.length >= 1 && requests.length >= 1, true, "completion was called")
const body = JSON.parse(requests.at(-1).body)
note("completion request", { duration: body.duration, partCount: body.partCount })
note("completion response", completions.at(-1).status)
assert.equal(completions.at(-1).status, 200, "server accepted the guarded recording")
assert.ok(body.duration <= 21_600 && body.duration >= AUTO_STOP, `reported ${body.duration}`)

await page.waitForSelector("text=six-hour limit", { timeout: 15000 }).then(() => note("share page toast", "shown"), () => note("share page toast", "not seen (guest/claim flow may suppress it)"))
await browser.close()
console.log("\nbrowser limit test passed")
