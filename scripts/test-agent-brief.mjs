// The two copies of a video's brief: the one a person pastes, and the plain one a share page links to.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"

const ts = createRequire(import.meta.url)("typescript")
const source = readFileSync("src/lib/agent.server.ts", "utf8")
const start = source.indexOf("export interface ScreenEvent")
const code = ts.transpileModule(source.slice(start), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const video = { url: "https://vertov.app/abcd1234", title: "Sign-in fix", duration: 40, summary: "It works.", chapters: [{ start: 3, title: "Before" }], transcript: null, aiStatus: "pending" }
const exports = {}
vm.runInNewContext(code, {
  exports,
  env: { BUCKET: { get: async () => ({ json: async () => [{ t: 2, type: "click", text: "Secret button" }] }) } },
  videoForAgent: async () => video,
  clock: (seconds) => `0:${String(Math.round(seconds)).padStart(2, "0")}`,
  mapToExport: (_upload, time) => time,
})

const pasted = await exports.agentPrompt({ id: "abcd1234" }, "https://vertov.app")
assert.match(pasted, /^Use the material below/)
assert.match(pasted, /Secret button/)
const plain = await exports.agentPrompt({ id: "abcd1234" }, "https://vertov.app", { plain: true })
assert.match(plain, /^# Sign-in fix/)
assert.doesNotMatch(plain, /Use the material|Secret button|What happened on screen|try again/)
for (const shown of ["It works.", "Before", "Still being transcribed", "https://vertov.app/abcd1234"]) assert.ok(plain.includes(shown), shown)
console.log("agent brief checks passed")
