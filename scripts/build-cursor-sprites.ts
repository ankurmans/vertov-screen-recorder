// Rasterises src/lib/cursor.ts art to exporter/cursors/<style>-<pose>.png (256 px, transparent) with rsvg-convert.
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { CURSOR_ART, CURSOR_STYLES } from "../src/lib/cursor"

mkdirSync("exporter/cursors", { recursive: true })
for (const style of CURSOR_STYLES) {
  const art = CURSOR_ART[style]
  for (const [pose, body] of [["idle", art.idle], ["press", art.press ?? art.idle]] as const) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="256" height="256">${body}</svg>`
    writeFileSync("/tmp/cursor-sprite.svg", svg)
    execFileSync("rsvg-convert", ["-w", "256", "-h", "256", "-o", `exporter/cursors/${style}-${pose}.png`, "/tmp/cursor-sprite.svg"])
  }
}
