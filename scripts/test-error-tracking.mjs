// The fingerprint is stable across what varies between two occurrences (ids, counts, line numbers, bundle hashes), differs for a
// different failure, scrubs emails and secrets, and drops browser noise. The tracker keeps the cause under a wrapped error.
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { DatabaseSync } from "node:sqlite"
import ts from "typescript"
import * as fingerprints from "../src/lib/error-fingerprint.ts"

const { causeMessage, fingerprintOf, ignorable, scrub, stackFrames, withCause, withoutParams, withoutStoredParams } = fingerprints

assert.equal(scrub("no user bob@example.com for 12345 at https://vertov.app/a1b2c3d4?x=1"), "no user <email> for <n> at https://vertov.app/<id>")
assert.ok(!scrub("Authorization Bearer sk_live_abcdef123456").includes("sk_live"))
assert.equal(scrub("Minified React error #418; visit https://react.dev/errors/418 for the full message"), "Minified React error #418; visit https://react.dev/errors/418 for the full message", "the React error number is kept")
assert.equal(scrub("upload 3f2a8c9e-1b4d-4e5f-8a7b-9c0d1e2f3a4b missing"), "upload <uuid> missing")

const frames = (line, hash) => stackFrames(`Error: x\n    at run (file:///worker/assets/process-${hash}.js:${line}:9)\n    at next (file:///worker/index.js:${line + 5}:3)`)
assert.deepEqual(frames(10, "aB3dE5fG"), frames(99, "zZ9yY8xX"), "line numbers and bundle hashes do not change the frames")

const a = await fingerprintOf("job", "Error", "Upload 3f2a8c9e-1b4d-4e5f-8a7b-9c0d1e2f3a4b missing", frames(10, "aB3dE5fG"))
const b = await fingerprintOf("job", "Error", "Upload 11111111-2222-3333-4444-555555555555 missing", frames(99, "zZ9yY8xX"))
const c = await fingerprintOf("job", "Error", "Render failed (500)", frames(10, "aB3dE5fG"))
const d = await fingerprintOf("queue", "Error", "Upload 3f2a8c9e-1b4d-4e5f-8a7b-9c0d1e2f3a4b missing", frames(10, "aB3dE5fG"))
assert.equal(a, b, "the same failure on two different videos is one fingerprint")
assert.notEqual(a, c)
assert.notEqual(a, d, "a different source is a different fingerprint")
assert.match(a, /^[0-9a-f]{16}$/)

for (const message of ["ResizeObserver loop completed with undelivered notifications.", "Script error.", "Failed to fetch", "Load failed"]) assert.ok(ignorable("Error", message, undefined), message)
assert.ok(ignorable("TypeError", "x is not a function", "TypeError\n    at a (chrome-extension://abc/content.js:1:1)"))
assert.ok(!ignorable("TypeError", "Cannot read properties of undefined (reading 'id')", "at f (https://vertov.app/assets/x.js:1:1)"))
assert.equal(ignorable("Error", "Uncaught Error: [SessionRecording] must be started with a valid sessionManager.", "Error: x\n    at get te (posthog)"), true, "PostHog's own recorder race is noise")
// Cause: the reason under Drizzle's wrapper, scrubbed and capped, never the wrapper's bound values or a plain-data cause.
const query = (cause) => new Error(`Failed query: insert into upload_parts values (${"?, ".repeat(300)})\nparams: ${"x".repeat(600)}`, { cause })
const timeout = new Error("D1_ERROR: D1 DB storage operation exceeded timeout for bob@example.com")
assert.equal(causeMessage(query(timeout)), "D1_ERROR: D1 DB storage operation exceeded timeout for <email>")
assert.equal(causeMessage(new Error("D1 overloaded", { cause: query(timeout) })), causeMessage(query(timeout)), "a wrapped query error is looked under")
assert.equal(causeMessage(new Error("x", { cause: new TypeError("y is not a function") })), "TypeError: y is not a function")
assert.equal(causeMessage(new Error("x", { cause: new SyntaxError(`Unexpected identifier "hello "private" body" is not valid JSON`) })), `SyntaxError: Unexpected identifier "<text>" is not valid JSON`)
for (const cause of [undefined, "a request body", { email: "bob@example.com" }, new Error("Failed query: select 1\nparams: secret words")]) assert.equal(causeMessage(new Error("x", { cause })), "")
assert.equal(causeMessage(new Error("x", { cause: new Error("z".repeat(900)) })).length, 200)
const loop = new Error("Failed query: loop")
loop.cause = loop
assert.equal(causeMessage(loop), "")
assert.equal(withCause("short", ""), "short")
assert.equal(withCause("m".repeat(500), "why").length, 500)
assert.ok(withCause("m".repeat(500), "why").endsWith(" [cause: why]"))

// Bound values: dropped from a failed query wherever it sits in the message, and nothing else is touched.
assert.equal(withoutParams("Failed query: select ?\nparams: My title,second\nline"), "Failed query: select ?")
assert.equal(withoutParams("export step will be retried: Failed query: select ?\nparams: My title"), "export step will be retried: Failed query: select ?")
for (const message of ["Render failed", "bad input\nparams: kept", "Failed query: select 1"]) assert.equal(withoutParams(message), message)
assert.equal(causeMessage(new Error("x", { cause: new Error("retried: Failed query: select ?\nparams: secret words") })), "retried: Failed query: select ?")
assert.equal(withoutStoredParams("Failed query: select ?\nparams: secret [cause: D1_ERROR: timeout]"), "Failed query: select ? [cause: D1_ERROR: timeout]")
assert.equal(withoutStoredParams("Failed query: select ?\nparams: secret"), "Failed query: select ?")
assert.equal(withoutStoredParams("Failed query: select ? [cause: timeout]"), "Failed query: select ? [cause: timeout]")

// The real reportError against the real table: the cause is stored and emailed, and the fingerprint does not move with it.
const sqlite = new DatabaseSync(":memory:")
sqlite.exec(fs.readFileSync("drizzle/0037_error_events.sql", "utf8"))
const DB = {
  prepare: (sql) => {
    const statement = (args) => ({
      run: async () => sqlite.prepare(sql).run(...args),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    })
    return { ...statement([]), bind: (...args) => statement(args) }
  },
}
const sent = []
const dependencies = {
  "cloudflare:workers": { env: { DB, ERROR_ALERT_EMAIL: "owner@example.com" }, waitUntil() {} },
  "@/lib/email-layout": { emailButton: () => "" },
  "@/lib/rate-limit.server": { allow: async () => true },
  "@/lib/mail.server": { withMailer: () => ({ EMAIL: { send: async (mail) => sent.push(mail) } }) },
  "@/lib/error-fingerprint": fingerprints,
}
const tracker = {}
const compiled = ts.transpileModule(fs.readFileSync("src/lib/error-report.server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(compiled, { exports: tracker, require: (name) => dependencies[name], Error, console })
const rows = () => sqlite.prepare("SELECT fingerprint, message, stack, count FROM error_events").all()
const failed = query(timeout)
const report = (cause) => {
  failed.cause = cause
  return tracker.reportError(failed, { source: "api", route: "/api/recordings/$id/parts" })
}

await report(undefined)
const [before] = rows()
assert.equal(before.message, scrub(withoutParams(failed.message)).slice(0, 500))
// The fingerprint is the one rows already have: hashed over the message with its values.
assert.equal(before.fingerprint, await fingerprintOf("api", "Error", scrub(failed.message).slice(0, 500), stackFrames(failed.stack)))
await report(timeout)
let [after] = rows()
assert.equal(rows().length, 1, "the cause does not change the fingerprint")
assert.equal(after.count, 2)
assert.ok(after.message.endsWith(" [cause: D1_ERROR: D1 DB storage operation exceeded timeout for <email>]"), "a row first seen without a cause gains it")
assert.equal(after.message.length, 500)
await report(undefined)
assert.equal(rows()[0].message, after.message, "a later report without a cause does not erase it")
await report(new Error("D1_ERROR: UNIQUE constraint failed: upload_parts.upload_id: SQLITE_CONSTRAINT"))
;[after] = rows()
assert.ok(after.message.includes("SQLITE_CONSTRAINT"), "the latest cause is kept")

sqlite.exec("DELETE FROM error_events")
sent.length = 0
await report(timeout)
assert.equal(sent.length, 1)
assert.ok(sent[0].text.includes("[cause: D1_ERROR: D1 DB storage operation exceeded timeout for <email>]"))
assert.ok(!sent[0].text.includes("bob@example.com") && !sent[0].html.includes("bob@example.com"))

// A failed query whose values reach neither the row, its stack, the alert nor the digest, even on lines that look like frames.
const secret = "Quarterly layoffs plan"
const leaky = new Error(`Failed query: update uploads set title = ?, transcript = ?\nparams: ${secret},hello\nat the offsite we discussed ${secret}`, { cause: timeout })
sqlite.exec("DELETE FROM error_events")
sent.length = 0
await tracker.reportError(leaky, { source: "api", route: "/api/recordings/$id" })
await tracker.sendErrorDigest()
const [stored] = rows()
assert.equal(stored.message, "Failed query: update uploads set title = ?, transcript = ? [cause: D1_ERROR: D1 DB storage operation exceeded timeout for <email>]")
assert.ok(stored.stack.startsWith("at ") && !stored.stack.includes(secret) && !stored.stack.includes("offsite"), "values are not read as frames")
assert.equal(sent.length, 2)
for (const mail of sent) for (const body of [mail.subject, mail.text, mail.html]) assert.ok(!body.includes(secret) && !body.includes("params:"))

// A row stored before this rule: the digest drops its values, and the next occurrence rewrites it even without a cause.
const legacy = () => sqlite.prepare("UPDATE error_events SET message = ?").run(`Failed query: update uploads set title = ?\nparams: ${secret}`)
legacy()
sent.length = 0
await tracker.sendErrorDigest()
assert.ok(sent[0].text.includes("Failed query: update uploads set title = ?") && !sent[0].text.includes(secret) && !sent[0].html.includes(secret))
leaky.cause = undefined
await tracker.reportError(leaky, { source: "api", route: "/api/recordings/$id" })
assert.equal(rows().length, 1)
assert.equal(rows()[0].message, "Failed query: update uploads set title = ?, transcript = ?")
console.log("error tracking: ok")
