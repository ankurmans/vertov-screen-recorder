import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import { capturedEvent } from "../extension/lib/capture-event.js"

function load(file, require = () => { throw new Error("Unexpected dependency") }) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require, Response, console })
  return exports
}
const { parseZooms, zoomAt, zoomsFromClicks } = load("src/lib/zooms.ts")
const stage = load("src/lib/stage.ts", () => ({ parseZooms }))
assert.equal("zooms" in stage.parseStyle({ zooms: [] }), false)
const exportModule = load("src/lib/export.server.ts", (name) => {
  if (name === "@/lib/stage") return stage
  if (name === "@/lib/ass") return { buildAss: () => null }
  if (name === "@/lib/caption-styles") return { isCaptionStyle: () => false }
  if (name === "@/lib/cuts") return { parseCuts: () => [] }
  if (name === "@/lib/overlays") return { parseOverlays: () => [] }
  return {}
})
const point = { id: "one", start: 1, duration: 3, x: 0.8, y: 0.2, scale: 2 }
const normalized = parseZooms([point, { ...point, id: "overlap", start: 2 }, { ...point, start: 5 }, { ...point, start: NaN }])
const upload = { style: JSON.stringify({ zooms: [point] }), width: 1920, height: 1080, trimStart: 1, captionStyle: "off" }
assert.equal(JSON.stringify((await exportModule.exportJob(upload)).zoom_points), JSON.stringify([point]))
assert.notEqual(exportModule.exportSignature(upload), exportModule.exportSignature({ ...upload, style: "{}" }))
assert.equal(exportModule.exportSignature({ ...upload, style: "{}" }), exportModule.exportSignature({ ...upload, style: '{"zooms":[]}' }))
assert.equal(normalized.length, 2)
assert.notEqual(normalized[0].id, normalized[1].id)
assert.equal(JSON.stringify(parseZooms(normalized)), JSON.stringify(normalized))
assert.equal(parseZooms(Array.from({ length: 101 }, (_, i) => ({ ...point, start: i * 4 }))).length, 100)
assert.equal(zoomAt([point], 0).scale, 1)
assert.equal(zoomAt([point], 1).scale, 1)
assert.equal(zoomAt([point], 2).scale, 2)
assert.equal(zoomAt([point], 4).scale, 1)
assert.ok(Math.abs(zoomAt([point], 1.225).scale - 1.5) < 1e-8)
for (const x of [0, 0.1, 0.5, 0.9, 1]) for (const y of [0, 0.5, 1]) {
  const z = zoomAt([{ ...point, x, y }], 2)
  assert.ok(z.x <= 0 && z.x >= 1 - z.scale)
  assert.ok(z.y <= 0 && z.y >= 1 - z.scale)
}
const auto = zoomsFromClicks([{ t: 1, x: 0.3, y: 0.3 }, { t: 3, x: 0.32, y: 0.3 }, { t: 2.1, x: 0.9, y: 0.9 }, { t: 7, x: 0.9, y: 0.9 }], 10)
assert.equal(auto.length, 2)
assert.ok(auto[0].duration > 3.5)
assert.equal(zoomsFromClicks([{ t: 9.9, x: 0.5, y: 0.5 }], 10).length, 0)

let events = [
  { type: "click", t: 1, x: 1, y: 0, viewportWidth: 1600, viewportHeight: 900, coordinateSpace: "recorded-tab" },
  { type: "click", t: 2, x: 0.5, y: 0.5 },
  { type: "click", t: 3, x: 0.5, y: 0.5, viewportWidth: 0, viewportHeight: 900, coordinateSpace: "recorded-tab" },
]
const { recordedZoomClicks } = load("src/lib/zooms.server.ts", () => ({ env: { BUCKET: { get: async () => ({ size: 100, json: async () => events }) } } }))
const clicks = await recordedZoomClicks({ id: "fixture", width: 1080, height: 1080 })
assert.equal(clicks.length, 1)
assert.equal(clicks[0].x, 1)
assert.ok(Math.abs(clicks[0].y - 0.21875) < 1e-8)

let allowed = false, signedIn = false
const route = load("src/routes/api/zooms.$id.ts", (name) => {
  if (name === "@tanstack/react-router") return { createFileRoute: () => (options) => options }
  if (name === "@/lib/api.server") return { json: (body, init) => Response.json(body, typeof init === "number" ? { status: init } : init) }
  if (name === "@/lib/recordings.server") return { userApi: (request, handler) => signedIn ? handler({ sub: "owner" }) : Response.json({}, { status: 401 }), ownedUpload: async () => allowed ? { id: "fixture", width: 1080, height: 1080 } : null }
  if (name === "@/lib/zooms.server") return { recordedZoomClicks }
  throw new Error(name)
}).Route
const get = () => route.server.handlers.GET({ request: new Request("https://example.com/api/zooms/fixture"), params: { id: "fixture" } })
assert.equal((await get()).status, 401)
signedIn = true
assert.equal((await get()).status, 404)
allowed = true
const response = await get()
assert.equal(response.status, 200)
assert.equal(response.headers.get("cache-control"), "private, no-store")
assert.equal(Object.keys((await response.json()).clicks[0]).sort().join(","), "t,x,y")
const event = { type: "click", x: 0.2, y: 0.7, viewportWidth: 1280, viewportHeight: 720, text: "Save" }
assert.equal(capturedEvent(event, { tab: { id: 1 }, frameId: 0 }, { zoomCaptureTab: 1 }).coordinateSpace, "recorded-tab")
for (const [tabId, frameId, captureTab] of [[2, 0, 1], [1, 1, 1], [1, 0, null], [1, 0, undefined]]) {
  const captured = capturedEvent({ ...event, coordinateSpace: "recorded-tab" }, { tab: { id: tabId }, frameId }, { zoomCaptureTab: captureTab })
  assert.equal(captured.coordinateSpace, undefined)
  assert.equal(captured.x, undefined)
  assert.equal(captured.text, "Save")
}
console.log("PASS zoom easing, edge bounds, click grouping, letterbox mapping, normalization and owner-only API")
