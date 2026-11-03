import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

function load(file, require = () => { throw new Error("Unexpected dependency") }) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require, console, crypto })
  return exports
}

// SRT download
const transcript = load("src/lib/transcript.ts", () => ({}))
assert.equal(
  transcript.vttToSrt("WEBVTT\n\nNOTE skipped\n\n00:00:01.000 --> 00:00:03.500 align:start\nHello\n\n00:05.000 --> 00:07.250\nTwo\nlines\n"),
  "1\n00:00:01,000 --> 00:00:03,500\nHello\n\n2\n00:00:05,000 --> 00:00:07,250\nTwo\nlines\n",
)
assert.equal(transcript.vttToSrt("WEBVTT\n"), "")

// Search indexing is opt-in and only for openly shared videos
const seo = load("src/lib/seo.ts")
const open = { searchIndexing: true, visibility: "link", expiresAt: null, requireEmail: false, mediaType: "video", status: "ready", deletedAt: null, archivedAt: null, hasPassword: false }
assert.equal(seo.isIndexable(open), true)
for (const gate of [{ searchIndexing: false }, { visibility: "workspace" }, { hasPassword: true }, { expiresAt: "2030-01-01" }, { requireEmail: true }, { status: "processing" }, { deletedAt: "x" }, { archivedAt: "x" }, { mediaType: "image" }])
  assert.equal(seo.isIndexable({ ...open, ...gate }), false, JSON.stringify(gate))
assert.equal(seo.isoDuration(67), "PT1M7S")
assert.equal(seo.isoDuration(0), "PT0S")
assert.equal(seo.isoDuration(3600), "PT1H")
assert.equal(seo.isoDate("2026-11-03 11:22:40"), "2026-11-03T11:22:40.000Z")

// Blur, spotlight and image overlays; images only from this app's own store
const overlays = load("src/lib/overlays.ts")
const parsed = overlays.parseOverlays([
  { type: "blur", start: 1, end: 3, x: 10, y: 10, w: 30, h: 20 },
  { type: "spotlight", start: 1, end: 3 },
  { type: "image", start: 1, end: 3, src: "/api/overlay-image/fbb41dbf/0ee0b54e62cec79c.png" },
  { type: "image", start: 1, end: 3, src: "https://evil.example/x.png" },
  { type: "image", start: 1, end: 3, src: "/api/overlay-image/fbb41dbf/../../secret.png" },
])
assert.equal(JSON.stringify(parsed.map((item) => item.type)), JSON.stringify(["blur", "spotlight", "image"]))
assert.equal(parsed[2].src, "/api/overlay-image/fbb41dbf/0ee0b54e62cec79c.png")

// Spotlight burns in as four dimming bands
const cuts = load("src/lib/cuts.ts")
const ass = load("src/lib/ass.ts", (name) => (name === "@/lib/cuts" ? cuts : name === "@/lib/caption-phrases" ? { phrasesOf: () => [] } : {}))
const script = ass.buildAss({ width: 1280, height: 720, overlays: overlays.parseOverlays([{ type: "spotlight", start: 1, end: 4, x: 40, y: 20, w: 20, h: 20 }]), transcript: null, captionStyle: "off", source: { trimStart: null, trimEnd: null, cuts: null } })
assert.equal(script.split("\n").filter((line) => line.startsWith("Dialogue:")).length, 4)
const blurOnly = ass.buildAss({ width: 1280, height: 720, overlays: overlays.parseOverlays([{ type: "blur", start: 1, end: 4 }]), transcript: null, captionStyle: "off", source: { trimStart: null, trimEnd: null, cuts: null } })
assert.equal(blurOnly.split("\n").filter((line) => line.startsWith("Dialogue:")).length, 0)

// Intro/outro ids survive style parsing; anything else is dropped
const stage = load("src/lib/stage.ts", () => ({ parseZooms: () => [] }))
const style = stage.parseStyle({ intro: "4ad4c3e4", outro: "not-an-id" })
assert.equal(style.intro, "4ad4c3e4")
assert.equal("outro" in style, false)
assert.equal("intro" in stage.parseStyle({}), false)

console.log("PASS SRT conversion, opt-in indexing gates, effect overlays and image src validation, spotlight burn-in, intro/outro style")
