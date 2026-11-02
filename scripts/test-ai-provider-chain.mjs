import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"
const exports = {}, calls = []
let rejectClaude = false
const code = ts.transpileModule(fs.readFileSync("src/lib/ai.server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, { exports, console: { log() {}, warn() {} }, require: (name) => {
  assert.equal(name, "cloudflare:workers")
  return { env: { ANTHROPIC_API_KEY: "fixture", GROQ_API_KEY: "fixture" } }
}, fetch: async (url, init) => {
  const body = JSON.parse(init.body); calls.push({ url, body })
  if (url.includes("anthropic")) {
    for (const key of ["temperature", "top_p", "top_k"]) assert.ok(!(key in body))
    assert.equal(body.model, "claude-sonnet-5-5")
    return rejectClaude ? { ok: false, status: 400, text: async () => "fixture rejection" } : { ok: true, json: async () => ({ content: [{ type: "text", text: '{"text":"Claude fixture"}' }] }) }
  }
  assert.equal(body.response_format.type, "json_object")
  return { ok: true, json: async () => ({ choices: [{ message: { content: '{"text":"Groq fixture"}' } }] }) }
} })
assert.equal(await exports.complete("system", "fixture"), '{"text":"Claude fixture"}')
rejectClaude = true
assert.equal(await exports.complete("system", "fixture"), '{"text":"Groq fixture"}')
assert.equal(await exports.complete("system", "fixture"), '{"text":"Groq fixture"}')
assert.equal(calls.filter((call) => call.url.includes("anthropic")).length, 2)
console.log("PASS Claude request omits deprecated sampling parameters; fallback and cooldown preserve JSON callers")
