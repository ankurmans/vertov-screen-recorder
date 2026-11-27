// Stage model checks: layouts keep their boxes on the stage, every wallpaper exists in both places it is served from.
// Run: npx tsx scripts/test-stage.mjs
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { BACKGROUNDS, DEFAULT_STYLE, FOCUS_RANGE, isCameraFirst, parseStyle, stageGeometry } from "../src/lib/stage.ts"

const root = new URL("..", import.meta.url).pathname
let n = 0
const ok = (name) => console.log(`ok ${++n} ${name}`)

for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16]) {
  for (const side of ["left", "right"]) {
    for (const scale of [undefined, FOCUS_RANGE.min, FOCUS_RANGE.max]) {
      const { screen, camera, stageAspect } = stageGeometry({ ...DEFAULT_STYLE, layout: "focus", side, scale }, aspect, true)
      assert.equal(stageAspect, aspect)
      assert.deepEqual(camera, { left: 0, top: 0, width: 100, height: 100 })
      assert.ok(screen.left >= 0 && screen.top >= 0 && screen.left + screen.width <= 100.0001 && screen.top + screen.height <= 100.0001, `focus box on stage at ${aspect} ${side} ${scale}`)
      // The screen keeps its own aspect: pixel width / pixel height equals the recording's.
      assert.ok(Math.abs((screen.width * aspect) / screen.height - aspect) < 1e-6 || screen.width < 99, "aspect kept")
    }
  }
}
ok("camera-first screen box stays on the stage at every aspect, side and size")

assert.equal(stageGeometry({ ...DEFAULT_STYLE, layout: "focus" }, 16 / 9, false).camera, null)
ok("no camera track falls back to screen only")

assert.equal(parseStyle({ layout: "focus", background: "aurora" }).layout, "focus")
assert.equal(parseStyle({ layout: "focus", background: "aurora" }).background, "aurora")
assert.equal(parseStyle({ layout: "nope", background: "nope" }).layout, "bubble")
assert.equal(parseStyle({ background: "constructor" }).background, "none")
assert.ok(isCameraFirst("focus", true) && !isCameraFirst("focus", false) && !isCameraFirst("bubble", true))
ok("parseStyle accepts the new layout and backgrounds, and rejects unknown keys")

const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const wallpapers = Object.entries(BACKGROUNDS).filter(([, b]) => b.image)
assert.ok(wallpapers.length >= 8)
for (const [key, b] of wallpapers) {
  for (const path of [`public/backgrounds/${b.image}`, `public/backgrounds/thumbs/${b.image}`, `exporter/backgrounds/${b.image}`]) {
    assert.ok(existsSync(root + path), `${key}: missing ${path}`)
  }
  assert.equal(hash(root + `public/backgrounds/${b.image}`), hash(root + `exporter/backgrounds/${b.image}`), `${key}: player and exporter wallpapers differ; run scripts/make-backgrounds.py`)
  assert.match(b.css, new RegExp(`/backgrounds/${b.image}`))
}
ok("every wallpaper exists in public, its thumbnail and the exporter, identical in both")

for (const [key, b] of Object.entries(BACKGROUNDS)) {
  assert.ok(b.colors.length >= 1 && b.colors.length <= 8, `${key}: 1 to 8 gradient stops for the exporter`)
  for (const c of b.colors) assert.match(c, /^#[0-9a-f]{6}$/i, `${key}: ${c}`)
}
ok("every background has 1 to 8 hex stops for the exported gradient")
console.log(`${n} groups passed`)
