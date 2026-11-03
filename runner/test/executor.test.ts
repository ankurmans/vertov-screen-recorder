import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import type { AddressInfo } from "node:net"
import { recipeSchema } from "../../src/lib/tutorials/recipe"
import type { Recipe } from "../../src/lib/tutorials/recipe"
import { chromePath } from "../src/config"
import { StepFailure, execute } from "../src/executor"
import type { NarrationPlan } from "../src/types"

process.env.VERTOV_EXPECT_TIMEOUT_MS = "1500"

let outsideHits = 0
let app: http.Server
let outside: http.Server
let appUrl = ""
let outsideUrl = ""
let sandbox = ""
let sessionFile = ""

const listen = (server: http.Server) => new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))

before(async () => {
  outside = http.createServer((_req, res) => {
    outsideHits++
    res.end("outside")
  })
  outsideUrl = await listen(outside)
  app = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html")
    res.end(`<!doctype html><title>Fixture</title><main>
      <h1>Fixture app</h1>
      <button id="open" onclick="document.getElementById('d').hidden=false">Open dialog</button>
      <div id="d" role="dialog" aria-label="Hello" hidden><label>Name <input id="n"></label><button onclick="document.getElementById('d').hidden=true;document.getElementById('done').textContent='Saved '+document.getElementById('n').value">Save</button></div>
      <p id="done"></p>
      <a href="${outsideUrl}/">Elsewhere</a></main>`)
  })
  appUrl = await listen(app)
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "runner-test-"))
  sessionFile = path.join(sandbox, "session.json")
  fs.writeFileSync(sessionFile, JSON.stringify({ cookies: [], origins: [] }))
})

after(() => {
  app?.close()
  outside?.close()
  fs.rmSync(sandbox, { recursive: true, force: true })
})

const recipe = (steps: unknown[]): Recipe =>
  recipeSchema.parse({ id: "fixture-recipe", version: 1, title: "Fixture", summary: "Fixture", allowedOrigins: ["app"], preconditions: [], parameters: [], steps })

const narrationFor = (r: Recipe): NarrationPlan => ({
  voice: "test",
  synthesized: false,
  wpm: 175,
  steps: r.steps.map((step) => ({ stepId: step.id, text: step.narration, audioPath: null, seconds: 0.3 })),
})

const run = (r: Recipe, name: string) => {
  const workdir = path.join(sandbox, name)
  return execute({ recipe: r, narration: narrationFor(r), sessionFile, appUrl, workdir, onProgress: async () => ({ cancel: false }) })
}

const step = (id: string, extra: Record<string, unknown>) => ({ id, goal: id, narration: "Say something about this step.", hold: 0.2, ...extra })

test("performs a recipe in a real browser, verifies results, records clicks and a WebM", { timeout: 60_000 }, async (t) => {
  if (!fs.existsSync(chromePath())) return t.skip("no Chrome for Testing available")
  const r = recipe([
    step("open", { actions: [{ type: "goto", path: "/" }, { type: "click", target: { role: "button", name: "Open dialog" } }], expect: [{ type: "visible", target: { role: "dialog", name: "Hello" } }] }),
    step("save", {
      actions: [{ type: "fill", target: { label: "Name" }, value: "Ada" }, { type: "click", target: { role: "button", name: "Save" } }],
      expect: [{ type: "hidden", target: { role: "dialog", name: "Hello" } }, { type: "visible", target: { text: "Saved Ada" } }],
    }),
    step("note", { actions: [{ type: "pause", seconds: 0.2 }], expect: [] }),
  ])
  const result = await run(r, "ok")
  assert.deepEqual(result.steps.map((s) => [s.stepId, s.verified]), [["open", true], ["save", true], ["note", false]])
  assert.ok(result.steps[2].note, "an unchecked step says so")
  assert.ok(result.steps[0].startMs >= 1500 && result.steps[1].startMs > result.steps[0].endMs - 1, "steps run in order after the lead-in")
  assert.ok(result.steps.every((s) => s.endMs >= s.actionsEndMs))
  assert.equal(result.clicks.length, 3)
  assert.ok(result.clicks.every((c) => c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1))
  assert.ok(result.durationMs >= result.steps[2].endMs)
  assert.ok(result.videoPath.endsWith(".webm") && fs.statSync(result.videoPath).size > 1000, "the recording exists and is not empty")
})

test("a failed expectation stops the run with the step id and a reason", { timeout: 60_000 }, async (t) => {
  if (!fs.existsSync(chromePath())) return t.skip("no Chrome for Testing available")
  const r = recipe([
    step("open", { actions: [{ type: "goto", path: "/" }], expect: [{ type: "visible", target: { role: "heading", name: "Fixture app" } }] }),
    step("missing", { actions: [{ type: "pause", seconds: 0.2 }], expect: [{ type: "visible", target: { role: "dialog", name: "Create a space" } }] }),
    step("never", { actions: [{ type: "pause", seconds: 0.2 }], expect: [] }),
  ])
  await assert.rejects(run(r, "fail"), (error: unknown) => {
    assert.ok(error instanceof StepFailure)
    assert.equal(error.stepId, "missing")
    assert.match(error.message, /Step missing: expected “Create a space” dialog to be visible/)
    assert.ok(error.screenshotPath && fs.existsSync(error.screenshotPath))
    assert.ok(error.videoPath && fs.existsSync(error.videoPath), "the footage up to the failure is kept")
    return true
  })
})

test("a click that would navigate off the app is blocked, and the step fails instead of succeeding elsewhere", { timeout: 60_000 }, async (t) => {
  if (!fs.existsSync(chromePath())) return t.skip("no Chrome for Testing available")
  const r = recipe([step("leave", { actions: [{ type: "goto", path: "/" }, { type: "click", target: { role: "link", name: "Elsewhere" } }, { type: "pause", seconds: 0.5 }], expect: [{ type: "visible", target: { role: "heading", name: "Fixture app" } }] })])
  await assert.rejects(run(r, "scope"), (error: unknown) => error instanceof StepFailure && error.stepId === "leave")
  assert.equal(outsideHits, 0, "the other origin was never contacted")
})

test("a goto outside the app is refused before any request is made", { timeout: 60_000 }, async (t) => {
  if (!fs.existsSync(chromePath())) return t.skip("no Chrome for Testing available")
  // The schema now rejects this up front; the executor still refuses it if a recipe ever arrives unvalidated.
  assert.throws(() => recipe([step("out", { actions: [{ type: "goto", path: "//evil.example/" }], expect: [] })]))
  const r = recipe([step("out", { actions: [{ type: "goto", path: "/" }], expect: [] })])
  ;(r.steps[0].actions[0] as { path: string }).path = "//evil.example/"
  await assert.rejects(run(r, "goto"), (error: unknown) => error instanceof StepFailure && /could not do \/\/evil/.test(error.message))
})

test("a recording left behind by an interrupted attempt is never mistaken for this run's footage", { timeout: 60_000 }, async (t) => {
  if (!fs.existsSync(chromePath())) return t.skip("no Chrome for Testing available")
  const stale = path.join(sandbox, "retry", "video", "page@stale.webm")
  fs.mkdirSync(path.dirname(stale), { recursive: true })
  fs.writeFileSync(stale, "partial")
  const result = await run(recipe([step("open", { actions: [{ type: "goto", path: "/" }], expect: [{ type: "visible", target: { role: "heading", name: "Fixture app" } }] })]), "retry")
  assert.notEqual(result.videoPath, stale)
  assert.ok(fs.statSync(result.videoPath).size > 1000)
})
