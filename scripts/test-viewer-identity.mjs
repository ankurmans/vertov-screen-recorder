import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const exports = {}, storage = new Map()
let result = { ok: true }, fail = false, calls = 0
const code = ts.transpileModule(fs.readFileSync("src/lib/viewer-identity.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
vm.runInNewContext(code, {
  exports, document: { referrer: "" },
  localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  fetch: async () => {
    calls++
    if (fail) throw new Error("Fixture network failure")
    return { ok: true, json: async () => result }
  },
})
assert.equal(await exports.recordShareView("one"), true)
assert.equal(await exports.recordShareView("one"), false)
assert.equal(calls, 1)
result = { owner: true }
assert.equal(await exports.recordShareView("owner"), false)
assert.equal(exports.hasViewedShare("owner"), false)
result = { ok: true }
fail = true
assert.equal(await exports.recordShareView("retry"), false)
fail = false
assert.equal(await exports.recordShareView("retry"), true)
const together = await Promise.all([exports.recordShareView("concurrent"), exports.recordShareView("concurrent")])
assert.equal(together.filter(Boolean).length, 1)
console.log("PASS browser deduplication, concurrent pings, owner exclusion, and retry after network failure")
