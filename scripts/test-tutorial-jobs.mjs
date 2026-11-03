import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import ts from "typescript"

// Transpile the real queue and recipe modules (no Worker imports) next to node_modules so zod resolves, and run them on SQLite.
const root = path.resolve("src/lib/tutorials")
const dir = fs.mkdtempSync(path.resolve("node_modules/.tutorial-test-"))
for (const file of ["queue", "recipe", "recipes", "jobs"]) {
  const source = fs.readFileSync(path.join(root, `${file}.ts`), "utf8").replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"')
  fs.writeFileSync(path.join(dir, `${file}.mjs`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
}
const q = Object.assign({}, ...(await Promise.all(["queue", "recipe", "recipes", "jobs"].map((file) => import(path.join(dir, `${file}.mjs`))))))

const sqlite = new DatabaseSync(":memory:")
sqlite.exec(fs.readFileSync("drizzle/0021_tutorial_jobs.sql", "utf8"))
const db = {
  prepare: (sql) => ({
    bind: (...values) => ({
      first: async () => sqlite.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values).changes } }),
    }),
  }),
}

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`ok  ${name}`)
}

const recipe = q.recipeById("create-space-and-organize")
const make = (id, ws, extra = {}) => q.createJob(db, { id, workspaceId: ws, userId: "u1", recipeId: recipe.id, recipeVersion: recipe.version, title: recipe.title, parameters: { spaceName: "Design reviews" }, presenter: false, ...extra })
const at = (seconds) => q.stamp(new Date(Date.UTC(2026, 10, 2, 12, 0, seconds)))

await test("the registered recipe validates and every placeholder has a parameter", () => {
  assert.equal(recipe.steps.length, 9)
  assert.ok(recipe.steps.every((step) => step.expect.length > 0), "every step has an expected result")
})

await test("recipes reject code, wildcard origins and unknown parameters", () => {
  const base = JSON.parse(JSON.stringify(recipe))
  const bad = (change) => assert.equal(q.recipeSchema.safeParse(change(JSON.parse(JSON.stringify(base)))).success, false)
  bad((r) => ((r.steps[0].actions[0] = { type: "evaluate", script: "alert(1)" }), r))
  bad((r) => ((r.steps[0].actions[0] = { type: "goto", path: "https://evil.example/" }), r))
  bad((r) => ((r.steps[0].actions[0] = { type: "goto", path: "//evil.example/" }), r))
  bad((r) => ((r.allowedOrigins = ["*"]), r))
  bad((r) => ((r.steps[1].narration = "Open {{missing}}"), r))
  bad((r) => ((r.steps[1].actions[0].target = { css: "button; fetch('x')" }), r))
  bad((r) => ((r.steps[1].actions[0].target = { role: "button", label: "two" }), r))
  bad((r) => ((r.steps[1].id = r.steps[0].id), r))
})

await test("parameters take defaults, enforce limits and reject unknown names", () => {
  assert.deepEqual(q.resolveParameters(recipe, {}), { ok: true, values: { spaceName: "Design reviews" } })
  assert.equal(q.resolveParameters(recipe, { spaceName: "x".repeat(41) }).ok, false)
  assert.equal(q.resolveParameters(recipe, { spaceName: "<b>" }).ok, false)
  assert.equal(q.resolveParameters(recipe, { other: "x" }).ok, false)
  const bound = q.bindRecipe(recipe, { spaceName: 'A "quoted" name' })
  assert.ok(JSON.stringify(bound).includes('A \\"quoted\\" name') && !JSON.stringify(bound).includes("{{"))
})

await test("narration is paced for teaching", () => {
  for (const step of recipe.steps) {
    const wpm = (q.wordCount(step.narration) / q.estimateSeconds(step.narration)) * 60
    assert.equal(Math.round(wpm), q.TARGET_WPM)
  }
})

await test("a runner claims the oldest queued job and nobody else gets it", async () => {
  await make("j1", "ws-a")
  await make("j2", "ws-a")
  const first = await q.claimNext(db, "ws-a", "runner-a", at(0))
  assert.equal(first.id, "j1")
  assert.equal(first.state, "running")
  assert.equal(first.attempts, 1)
  const second = await q.claimNext(db, "ws-a", "runner-b", at(1))
  assert.equal(second.id, "j2")
  assert.equal(await q.claimNext(db, "ws-a", "runner-c", at(2)), null)
})

await test("another workspace cannot claim, read, progress, complete, fail or cancel the job", async () => {
  await make("j3", "ws-a")
  assert.equal(await q.claimNext(db, "ws-b", "runner-x", at(3)), null)
  assert.equal(await q.getJob(db, "ws-b", "j3"), null)
  assert.deepEqual(await q.reportProgress(db, "ws-b", "j3", "runner-x", { stage: "recording" }, at(3)), { ok: false, reason: "not_found" })
  assert.equal((await q.completeJob(db, "ws-b", "j3", "runner-x", { videoId: "abcd1234", verified: [] }, at(3))).ok, false)
  assert.equal((await q.failJob(db, "ws-b", "j3", "runner-x", { error: "x", retryable: false }, at(3))).ok, false)
  assert.equal(await q.cancelJob(db, "ws-b", "j3", at(3)), "not_found")
  assert.equal((await q.getJob(db, "ws-a", "j3")).state, "queued")
  assert.equal((await q.listJobs(db, "ws-b")).length, 0)
})

await test("only the claiming runner can report on or finish a job", async () => {
  const job = await q.claimNext(db, "ws-a", "runner-a", at(10))
  assert.equal(job.id, "j3")
  assert.deepEqual(await q.reportProgress(db, "ws-a", "j3", "runner-b", { stage: "recording" }, at(11)), { ok: false, reason: "not_yours" })
  assert.equal((await q.completeJob(db, "ws-a", "j3", "runner-b", { videoId: "abcd1234", verified: [] }, at(11))).ok, false)
  const ok = await q.reportProgress(db, "ws-a", "j3", "runner-a", { stage: "recording", step: "new-space", percent: 30 }, at(12))
  assert.deepEqual(ok, { ok: true, cancel: false })
  assert.equal((await q.getJob(db, "ws-a", "j3")).percent, 30)
})

await test("completion is idempotent and one video cannot finish two jobs", async () => {
  const verified = [{ step: "open-library", verified: true }]
  const first = await q.completeJob(db, "ws-a", "j3", "runner-a", { videoId: "abcd1234", verified }, at(20))
  assert.equal(first.ok, true)
  const again = await q.completeJob(db, "ws-a", "j3", "runner-a", { videoId: "abcd1234", verified }, at(21))
  assert.equal(again.ok && again.already, true)
  assert.equal((await q.completeJob(db, "ws-a", "j3", "runner-a", { videoId: "ffff0000", verified }, at(22))).ok, false)
  const job = await q.getJob(db, "ws-a", "j3")
  assert.equal(job.state, "completed")
  assert.equal(job.video_id, "abcd1234")
  await make("j4", "ws-a")
  await q.claimNext(db, "ws-a", "runner-a", at(23))
  assert.equal((await q.completeJob(db, "ws-a", "j4", "runner-a", { videoId: "abcd1234", verified }, at(24))).ok, false)
  await q.failJob(db, "ws-a", "j4", "runner-a", { error: "cleanup", retryable: false }, at(25))
})

await test("an abandoned job is reclaimed, then fails once attempts run out", async () => {
  await make("j5", "ws-t1")
  const claim = (s, runner) => q.claimNext(db, "ws-t1", runner, at(s))
  assert.equal((await claim(100, "r1")).attempts, 1)
  assert.equal(await claim(110, "r2"), null, "still held while the claim is fresh")
  assert.equal((await claim(100 + 121, "r2")).attempts, 2)
  assert.equal((await claim(100 + 121 + 121, "r3")).attempts, 3)
  assert.equal(await claim(100 + 121 * 3, "r4"), null)
  const row = await q.getJob(db, "ws-t1", "j5")
  assert.equal(row.state, "failed")
  assert.match(row.error, /ran out of attempts/)
  assert.deepEqual(await q.reportProgress(db, "ws-t1", "j5", "r3", { stage: "recording" }, at(100 + 121 * 3)), { ok: false, reason: "not_running" })
})

await test("a late runner whose claim expired cannot keep reporting", async () => {
  await make("j6", "ws-t2")
  await q.claimNext(db, "ws-t2", "slow", at(1000))
  assert.deepEqual(await q.reportProgress(db, "ws-t2", "j6", "slow", { stage: "recording" }, at(1000 + 130)), { ok: false, reason: "expired" })
})

await test("a failed step reports its reason; only retryable failures requeue, within the attempt limit", async () => {
  await make("j7", "ws-t3")
  await q.claimNext(db, "ws-t3", "r1", at(2000))
  const failed = await q.failJob(db, "ws-t3", "j7", "r1", { error: "Step new-space: expected the dialog to be visible", stepId: "new-space", retryable: false }, at(2001))
  assert.equal(failed.state, "failed")
  const row = await q.getJob(db, "ws-t3", "j7")
  assert.equal(row.state, "failed")
  assert.equal(row.video_id, null)
  assert.match(row.error, /expected the dialog/)
  await make("j8", "ws-t3")
  await q.claimNext(db, "ws-t3", "r1", at(2010))
  assert.equal((await q.failJob(db, "ws-t3", "j8", "r1", { error: "browser crashed", retryable: true }, at(2011))).state, "queued")
  assert.equal((await q.claimNext(db, "ws-t3", "r2", at(2012))).attempts, 2)
})

await test("cancelling: queued jobs stop at once, running jobs tell their runner, finished jobs are untouched", async () => {
  await make("j9", "ws-t4")
  assert.equal(await q.cancelJob(db, "ws-t4", "j9", at(3000)), "cancelled")
  assert.equal(await q.claimNext(db, "ws-t4", "r1", at(3001)), null)
  await make("j10", "ws-t4")
  await q.claimNext(db, "ws-t4", "r1", at(3010))
  assert.equal(await q.cancelJob(db, "ws-t4", "j10", at(3011)), "running")
  assert.deepEqual(await q.reportProgress(db, "ws-t4", "j10", "r1", { stage: "recording" }, at(3012)), { ok: true, cancel: true })
  assert.equal((await q.failJob(db, "ws-t4", "j10", "r1", { error: "Cancelled", retryable: true }, at(3013))).state, "cancelled")
  assert.equal(await q.cancelJob(db, "ws-a", "j3", at(3014)), "completed")
  assert.equal((await q.getJob(db, "ws-a", "j3")).state, "completed")
})

await test("a cancelled job whose runner vanished is cancelled, not retried", async () => {
  await make("j11", "ws-t5")
  await q.claimNext(db, "ws-t5", "r1", at(4000))
  await q.cancelJob(db, "ws-t5", "j11", at(4001))
  await q.claimNext(db, "ws-t5", "r2", at(4000 + 130))
  assert.equal((await q.getJob(db, "ws-t5", "j11")).state, "cancelled")
})

await test("runner availability follows its last request", async () => {
  await q.touchRunner(db, "ws-c", "r1", at(5000))
  assert.equal(await q.runnerOnline(db, "ws-c", at(5060)), true)
  assert.equal(await q.runnerOnline(db, "ws-c", at(5100)), false)
  assert.equal(await q.runnerOnline(db, "ws-d", at(5000)), false)
})

console.log(`${passed} passed`)
fs.rmSync(dir, { recursive: true, force: true })
