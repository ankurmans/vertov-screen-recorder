import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import { DatabaseSync } from "node:sqlite"

const sqlite = new DatabaseSync(":memory:")
sqlite.exec(fs.readFileSync("drizzle/0019_notifications.sql", "utf8"))
sqlite.exec(`CREATE TABLE user(id TEXT, email TEXT); CREATE TABLE uploads(id TEXT, owner_id TEXT, title TEXT);
INSERT INTO user VALUES ('owner', 'fixture@example.com'); INSERT INTO uploads VALUES ('video', 'owner', '<script>Fixture</script>');`)
const prepare = (sql) => ({
  bind(...values) {
    return {
      first: async () => sqlite.prepare(sql).get(...values) ?? null,
      run: async () => sqlite.prepare(sql).run(...values),
      execute: () => ({ results: sqlite.prepare(sql).all(...values) }),
    }
  },
})
const queued = [], sent = [], warnings = []
let failMail = false
const env = { DB: { prepare, batch: async (statements) => {
  sqlite.exec("BEGIN")
  try { const results = statements.map((statement) => statement.execute()); sqlite.exec("COMMIT"); return results }
  catch (error) { sqlite.exec("ROLLBACK"); throw error }
} }, PROCESS_QUEUE: { send: async (...args) => queued.push(args) }, SES_ACCESS_KEY_ID: "fixture", SES_SECRET_ACCESS_KEY: "fixture" }
const exports = {}
const code = ts.transpileModule(fs.readFileSync("src/lib/notifications.server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, { exports, console: { warn: (message) => warnings.push(message) }, require: (name) => {
  if (name === "cloudflare:workers") return { env }
  if (name === "@/lib/mail.server") return { withMailer: () => ({ EMAIL_FROM: "fixture@example.com", EMAIL: { send: async (message) => { if (failMail) throw new Error("SES unverified"); sent.push(message) } } }) }
  throw new Error(name)
} })
const upload = { id: "video", ownerId: "owner" }
await exports.recordNotification(upload, "view", "owner")
await exports.recordNotification(upload, "comment", "owner")
assert.equal(queued.length, 0)
await Promise.all(Array.from({ length: 10 }, () => exports.recordNotification(upload, "view", "viewer")))
await Promise.all(Array.from({ length: 10 }, () => exports.recordNotification(upload, "comment", "viewer")))
assert.equal(queued.length, 1)
assert.equal(queued[0][1].delaySeconds, 900)
await Promise.all([exports.sendVideoNotification("video"), exports.sendVideoNotification("video")])
assert.equal(sent.length, 1)
assert.match(sent[0].text, /10 new comments/)
assert.match(sent[0].text, /first time/)
assert.ok(!sent[0].html.includes("<script>"))
await exports.recordNotification(upload, "view", "viewer")
assert.equal(queued.length, 1)
await exports.saveNotificationPreferences("owner", false, false)
await exports.recordNotification(upload, "comment", "viewer")
assert.equal(queued.length, 1)
await exports.saveNotificationPreferences("owner", true, true)
await exports.recordNotification(upload, "comment", "viewer")
failMail = true
await assert.doesNotReject(exports.sendVideoNotification("video"))
assert.equal(warnings.length, 1)
assert.equal(sqlite.prepare("SELECT scheduled FROM video_notifications").get().scheduled, 0)
console.log("PASS owner exclusion, concurrent first-view deduplication, comment batching, 900-second delay, duplicate-job suppression, preferences, HTML escaping and SES failure isolation")
