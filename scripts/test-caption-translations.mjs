import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import { webcrypto } from "node:crypto"

const load = (file, dependencies) => {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require: (name) => { assert.ok(name in dependencies, name); return dependencies[name] }, crypto: webcrypto, TextEncoder })
  return exports
}
const transcriptHelpers = load("src/lib/transcript.ts", {})
const cues = Array.from({ length: 23 }, (_, index) => ({ start: index * 2, end: index * 2 + 1.5, text: `Caption ${index}` }))
let saved, calls = 0, malformed = false
const translations = load("src/lib/translation.server.ts", {
  "cloudflare:workers": { env: { BUCKET: { head: async () => false, put: async (key, body) => { saved = { key, body } } } } },
  "@/lib/ai.server": { complete: async (_, input) => { calls++; return JSON.stringify({ texts: malformed ? [] : JSON.parse(input).map((_, i) => `Traduction ${i}`) }) } },
  "@/lib/caption-languages": { CAPTION_LANGUAGES: { fr: "French" } },
  "@/lib/uploads.server": { getTranscript: async () => ({ cues }) },
  "@/lib/transcript": transcriptHelpers,
})
await translations.translateCaptions({ id: "test" }, "fr")
assert.equal(calls, 2)
assert.ok(saved.key.endsWith("/fr.vtt"))
assert.equal((saved.body.match(/-->/g) || []).length, cues.length)
assert.ok(saved.body.includes("00:00:44.000 --> 00:00:45.500"))
saved = null; malformed = true
await assert.rejects(translations.translateCaptions({ id: "test" }, "fr"), /incomplete/)
assert.equal(saved, null)
await assert.rejects(translations.translateCaptions({ id: "test" }, "toString"), /Unknown language/)
console.log("PASS caption batches, timing preservation, incomplete output rejection, language validation")
