import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const exports = {}
let supported = new Set()
const code = ts.transpileModule(fs.readFileSync("src/lib/part-uploader.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
vm.runInNewContext(code, { exports, MediaRecorder: { isTypeSupported: (mime) => supported.has(mime) } })

supported = new Set(["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/mp4;codecs=avc1,mp4a", "video/mp4"])
assert.equal(exports.pickVideoMimeType(), "video/webm;codecs=vp8,opus")
supported.delete("video/webm;codecs=vp8,opus")
assert.equal(exports.pickVideoMimeType(), "video/webm;codecs=vp9,opus")
supported = new Set(["video/mp4;codecs=avc1,mp4a", "video/mp4"])
assert.equal(exports.pickVideoMimeType(), "video/mp4;codecs=avc1,mp4a")
supported = new Set(["video/mp4"])
assert.equal(exports.pickVideoMimeType(), "video/mp4")
console.log("PASS WebM capture is preferred when available; MP4-only browsers retain their fallback")
