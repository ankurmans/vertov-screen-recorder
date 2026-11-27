// Hosted stacks skip ensureSchema(), so everything it creates must also come from drizzle/ migrations.
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import vm from "node:vm"
import ts from "typescript"

const root = new URL("../", import.meta.url)
const db = new DatabaseSync(":memory:")
for (const file of readdirSync(new URL("drizzle/", root)).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(readFileSync(new URL(`drizzle/${file}`, root), "utf8"))
}
const columnsOf = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name))
const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name))

const source = readFileSync(new URL("src/lib/uploads.server.ts", root), "utf8")
const apply = source.slice(source.indexOf("export async function applySchema"), source.indexOf("export async function getLikeCount"))

const wanted = []
for (const [, table, body] of apply.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \((.*)\)"/g)) {
  const parts = body.replace(/\([^()]*(\([^()]*\))*[^()]*\)/g, "()").split(",")
  for (const part of parts) if (!/^\s*PRIMARY KEY/.test(part)) wanted.push([table, part.trim().split(" ")[0]])
}
for (const [, table, column] of apply.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+) /g)) wanted.push([table, column])
const v2 = apply.slice(apply.indexOf("v2Columns"), apply.indexOf("for (const [name, definition] of v2Columns)"))
for (const [, column] of v2.matchAll(/\["(\w+)", "/g)) wanted.push(["uploads", column])

assert.ok(wanted.length > 30, `parsed only ${wanted.length} columns from applySchema`)
for (const [table, column] of wanted) assert.ok(columnsOf(table).has(column), `${table}.${column} is in applySchema but no migration creates it`)
for (const [, index] of apply.matchAll(/CREATE INDEX IF NOT EXISTS (\w+) /g)) assert.ok(indexes.has(index), `index ${index} has no migration`)

assert.match(source, /if \(schemaApplied \|\| isHosted\(\)\) return;/)
// A promise kept at module level would be shared between requests again.
assert.doesNotMatch(source, /^let \w+: Promise</m)

const start = readFileSync(new URL("src/start.ts", root), "utf8")
assert.match(start, /requestMiddleware: \[reportRouteErrors, csrf\]/)
// A route error is recorded without the values a failed query was given, and is still thrown on.
const tracked = []
let middleware
const code = ts.transpileModule(start, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, {
  exports: {},
  require: (name) =>
    name === "@/lib/error-report.server"
      ? { trackError: (error, context) => tracked.push({ error, context }) }
      : {
          createMiddleware: () => ({ server: (fn) => (middleware ??= fn) }),
          createCsrfMiddleware: () => ({}),
          createStart: (options) => options,
        },
  Error,
})
const failure = new Error("Failed query: select 1 where title = ?\nparams: Private title\n  at Private line", { cause: new Error("D1_ERROR: boom") })
await assert.rejects(middleware({ pathname: "/api/likes/x", next: async () => { throw failure } }), (error) => error === failure)
assert.equal(tracked[0].error.message, "Failed query: select 1 where title = ?")
assert.equal(tracked[0].error.cause.message, "D1_ERROR: boom")
assert.ok(!tracked[0].error.stack.includes("Private"), "query values reached the stack")
assert.equal(tracked[0].context.source, "api")

console.log(`schema migrations: ${wanted.length} columns covered, all checks passed`)
