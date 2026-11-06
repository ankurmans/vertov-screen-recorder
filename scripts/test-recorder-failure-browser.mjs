// Can a web recording be lost when finalisation fails? Drives the REAL recorder in Chrome against a LOCAL worker, makes the
// completion request fail, then reloads the page and recovers the take from the browser's own copy.
// Start the worker first (see test-recorder-limit-browser.mjs). Run: BASE=http://localhost:8816 node scripts/test-recorder-failure-browser.mjs
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const BASE = process.env.BASE ?? "http://localhost:8816"
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("Local worker only.")
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/private/tmp/vertov-browser-test/node_modules/playwright-core")

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] })
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const note = (name, value) => console.log(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
const anon = await context.request.post(`${BASE}/api/auth/sign-in/anonymous`, { headers: { origin: BASE, "content-type": "application/json" }, data: {} })
assert.equal(anon.status(), 200)
await context.addInitScript(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext("2d")
    let n = 0
    setInterval(() => { ctx.fillStyle = `hsl(${(n += 3) % 360} 60% 40%)`; ctx.fillRect(0, 0, 640, 360) }, 100)
    return canvas.captureStream(10)
  }
})
const page = await context.newPage()
let failCompletion = true
const completions = []
await page.route(/\/api\/recordings\/[^/]+\/complete$/, async (route) => {
  if (failCompletion) {
    completions.push("blocked")
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Service unavailable" }) })
  }
  completions.push("passed")
  return route.continue()
})
await page.goto(`${BASE}/record`)
await page.getByRole("button", { name: "Choose a screen" }).click()
await page.getByRole("button", { name: "Start recording" }).click()
await page.waitForFunction(() => /Recording/.test(document.body.innerText) && !/Starting/.test(document.body.innerText), null, { timeout: 20000 })
await page.waitForTimeout(6000)
await page.locator('button[title="Stop and copy link"]').first().click()
await page.waitForSelector("text=safe in this browser", { timeout: 30000 }).catch(async (error) => {
  note("page text when the message did not appear", (await page.evaluate(() => document.body.innerText)).slice(0, 600))
  note("completion requests seen", completions)
  await page.screenshot({ path: process.env.SHOT ?? "/tmp/recorder-failure.png" }).catch(() => {})
  throw error
})
note("after a failed finalisation", await page.evaluate(() => document.body.innerText.match(/[^\n]*safe in this browser[^\n]*/)?.[0]))
assert.equal(completions.at(-1), "blocked")

// The take is in IndexedDB: reload the page (a closed or crashed tab looks the same) and find it listed.
await page.reload()
await page.waitForSelector("text=We saved a recording that didn't finish uploading", { timeout: 20000 })
note("after reload", "the saved take is listed")
const kept = await page.evaluate(
  () => new Promise((resolve) => {
    const open = indexedDB.open("reelay-backup")
    open.onsuccess = () => {
      const tx = open.result.transaction(["takes", "chunks"], "readonly")
      const takes = tx.objectStore("takes").getAll()
      const chunks = tx.objectStore("chunks").count()
      tx.oncomplete = () => resolve({ takes: takes.result.map((t) => t.seconds), chunks: chunks.result })
    }
  }),
)
note("browser copy", kept)
assert.ok(kept.chunks > 0 && kept.takes.some((s) => s >= 4))

failCompletion = false
await page.getByRole("button", { name: "Upload it now" }).click()
await page.waitForURL(/\/[0-9a-f]{8}\?new=1/, { timeout: 30000 })
note("recovered into", page.url().replace(BASE, ""))
assert.equal(completions.at(-1), "passed")
await browser.close()
console.log("\nrecorder failure recovery test passed")
