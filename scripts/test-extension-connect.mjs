// The extension connect handoff is bound to the Connect click that started it: the popup's one-time state,
// the server it chose, the manifest exposure of connect.html, the route's id allowlist and the framing headers.
// Run: npx tsx scripts/test-extension-connect.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import { CHROME_EXTENSION_ID, CHROME_STORE_URL } from "../src/lib/brand.ts"
import { blockFraming, connectFragment, extensionAllowed, isLocalHost, parseConnectState, parseExtensionId } from "../src/lib/extension-connect.ts"
import { PENDING_KEY, PENDING_TTL_MS, acceptHandoff, connectUrl, newState, startConnect } from "../extension/lib/connect-binding.js"

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// A stand-in for chrome.storage.session.
const memory = () => {
  const data = {}
  return {
    data,
    async get(key) {
      return key in data ? { [key]: data[key] } : {}
    },
    async set(values) {
      Object.assign(data, values)
    },
    async remove(key) {
      delete data[key]
    },
  }
}

const SERVER = "https://vertov.app"
const TOKEN = `rk_${"a1".repeat(20)}`
const OTHER_TOKEN = `rk_${"b2".repeat(20)}`
const NOW = 1_800_000_000_000

await test("a state is 32 hex characters and differs each time", () => {
  const a = newState()
  assert.match(a, /^[a-f0-9]{32}$/)
  assert.notEqual(a, newState())
})

await test("a handoff with the popup's state and server is accepted once, then the request is used up", async () => {
  const session = memory()
  const state = await startConnect(session, `${SERVER}/anything`, NOW)
  assert.deepEqual(session.data[PENDING_KEY], { state, server: SERVER, at: NOW })
  const accepted = await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "Acme", state }, NOW + 1000)
  assert.deepEqual(accepted, { server: SERVER, token: TOKEN, workspace: "Acme" })
  assert.equal(PENDING_KEY in session.data, false)
  assert.equal(await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "Acme", state }, NOW + 2000), null)
})

await test("nothing is stored when no Connect click is pending", async () => {
  const session = memory()
  assert.equal(await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "x", state: newState() }, NOW), null)
  assert.equal(await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "x", state: null }, NOW), null)
})

await test("a missing or wrong state is refused, and the pending request is consumed", async () => {
  for (const wrong of [null, "", newState(), "x".repeat(32)]) {
    const session = memory()
    const state = await startConnect(session, SERVER, NOW)
    assert.notEqual(wrong, state)
    assert.equal(await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "x", state: wrong }, NOW + 1), null)
    assert.equal(PENDING_KEY in session.data, false)
    // The right state no longer works either: the user clicks Connect again.
    assert.equal(await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "x", state }, NOW + 2), null)
  }
})

await test("a server other than the one the popup chose is refused, even with the right state and a valid key", async () => {
  const session = memory()
  const state = await startConnect(session, SERVER, NOW)
  assert.equal(await acceptHandoff(session, { server: "https://other.example", token: OTHER_TOKEN, workspace: "x", state }, NOW + 1), null)
  const again = memory()
  const second = await startConnect(again, SERVER, NOW)
  assert.equal(await acceptHandoff(again, { server: "http://vertov.app", token: TOKEN, workspace: "x", state: second }, NOW + 1), null)
  const unparsable = memory()
  const third = await startConnect(unparsable, SERVER, NOW)
  assert.equal(await acceptHandoff(unparsable, { server: "not a url", token: TOKEN, workspace: "x", state: third }, NOW + 1), null)
})

await test("a request older than the time limit is refused", async () => {
  const session = memory()
  const state = await startConnect(session, SERVER, NOW)
  assert.equal(await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "x", state }, NOW + PENDING_TTL_MS), null)
  const fresh = memory()
  const next = await startConnect(fresh, SERVER, NOW)
  assert.ok(await acceptHandoff(fresh, { server: SERVER, token: TOKEN, workspace: "x", state: next }, NOW + PENDING_TTL_MS - 1))
})

await test("a malformed key is refused", async () => {
  for (const bad of [null, "", "rk_short", `rk_${"A1".repeat(20)}`, `sk_${"a1".repeat(20)}`]) {
    const session = memory()
    const state = await startConnect(session, SERVER, NOW)
    assert.equal(await acceptHandoff(session, { server: SERVER, token: bad, workspace: "x", state }, NOW + 1), null)
  }
})

await test("a second Connect click replaces the first request", async () => {
  const session = memory()
  const first = await startConnect(session, SERVER, NOW)
  const second = await startConnect(session, "http://localhost:8787", NOW + 10)
  assert.equal(await acceptHandoff(session, { server: SERVER, token: TOKEN, workspace: "x", state: first }, NOW + 20), null)
  const again = memory()
  await startConnect(again, SERVER, NOW)
  const latest = await startConnect(again, "http://localhost:8787", NOW + 10)
  assert.ok(await acceptHandoff(again, { server: "http://localhost:8787", token: TOKEN, workspace: null, state: latest }, NOW + 20))
  assert.notEqual(first, second)
})

await test("the connect URL carries the extension id and the state", () => {
  const state = newState()
  assert.equal(connectUrl("https://vertov.app/settings", "a".repeat(32), state), `https://vertov.app/connect-extension?ext=${"a".repeat(32)}&state=${state}`)
})

await test("popup.js starts every Connect with a stored state, and connect.js stores only through acceptHandoff", () => {
  const popup = fs.readFileSync("extension/popup.js", "utf8")
  assert.match(popup, /startConnect\(chrome\.storage\.session, origin\)/)
  assert.match(popup, /connectUrl\(origin, chrome\.runtime\.id, state\)/)
  assert.doesNotMatch(popup, /connect-extension\?ext=/)
  const connect = fs.readFileSync("extension/connect.js", "utf8")
  assert.match(connect, /acceptHandoff\(chrome\.storage\.session/)
  assert.match(connect, /chrome\.storage\.local\.set\(accepted\)/)
  assert.equal((connect.match(/storage\.local\.set/g) ?? []).length, 1)
  assert.doesNotMatch(connect, /new URL\(server\)/)
})

await test("manifest: connect.html is exposed to the site's own origins only; bubble.html is unchanged", () => {
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"))
  const entries = manifest.web_accessible_resources
  const connect = entries.filter((entry) => entry.resources.includes("connect.html"))
  assert.equal(connect.length, 1)
  assert.deepEqual(connect[0].resources, ["connect.html"])
  assert.deepEqual(connect[0].matches, ["https://vertov.app/*", "http://localhost/*", "http://127.0.0.1/*"])
  const bubble = entries.filter((entry) => entry.resources.includes("bubble.html"))
  assert.equal(bubble.length, 1)
  assert.deepEqual(bubble[0].matches, ["<all_urls>"])
  assert.ok(manifest.host_permissions.includes("https://vertov.app/*"))
})

await test("the hosted origin in brand.js matches the manifest's connect.html origin", () => {
  const brand = fs.readFileSync("extension/brand.js", "utf8")
  const hosted = brand.match(/DEFAULT_SERVER = "([^"]+)"/)[1]
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"))
  assert.ok(manifest.web_accessible_resources.find((entry) => entry.resources.includes("connect.html")).matches.includes(`${hosted}/*`))
})

await test("route: state and extension id are validated shapes", () => {
  assert.equal(parseConnectState("a".repeat(32)), "a".repeat(32))
  for (const bad of [undefined, null, 5, "", "a".repeat(31), "a".repeat(33), "A".repeat(32), "g".repeat(32), `${"a".repeat(31)}\n`]) assert.equal(parseConnectState(bad), undefined)
  assert.equal(parseExtensionId("a".repeat(32)), "a".repeat(32))
  for (const bad of [undefined, 5, "a".repeat(31), "q".repeat(32), "../etc"]) assert.equal(parseExtensionId(bad), undefined)
})

await test("route: the published extension id is the one in the store URL", () => {
  assert.ok(CHROME_STORE_URL.endsWith(`/${CHROME_EXTENSION_ID}`))
  assert.match(CHROME_EXTENSION_ID, /^[a-p]{32}$/)
})

await test("route: hosted site trusts only the published id; local development and self-hosting accept any well-formed id", () => {
  const other = "a".repeat(32)
  assert.equal(extensionAllowed(CHROME_EXTENSION_ID, { local: false, hosted: true }), true)
  assert.equal(extensionAllowed(other, { local: false, hosted: true }), false)
  assert.equal(extensionAllowed(undefined, { local: false, hosted: true }), false)
  assert.equal(extensionAllowed(other, { local: true, hosted: true }), true)
  assert.equal(extensionAllowed(other, { local: false, hosted: false }), true)
  assert.equal(extensionAllowed("not-an-id", { local: true, hosted: false }), false)
  assert.equal(extensionAllowed(undefined, { local: true, hosted: false }), false)
})

await test("route: local hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "app.localhost"]) assert.equal(isLocalHost(host), true, host)
  for (const host of ["vertov.app", "localhost.evil.example", "evil-localhost", "127.0.0.1.evil.example"]) assert.equal(isLocalHost(host), false, host)
})

await test("route: the fragment carries the state next to the server, key and workspace", () => {
  const state = newState()
  const params = new URLSearchParams(connectFragment({ server: SERVER, token: TOKEN, workspace: "Acme & Co", state }))
  assert.equal(params.get("state"), state)
  assert.equal(params.get("server"), SERVER)
  assert.equal(params.get("token"), TOKEN)
  assert.equal(params.get("workspace"), "Acme & Co")
})

await test("route: the page only hands over a key for a trusted id and a state, and keeps both through sign-in", () => {
  const route = fs.readFileSync("src/routes/connect-extension.tsx", "utf8")
  assert.match(route, /if \(!ext \|\| !state \|\| !trusted\) return/)
  assert.match(route, /connectFragment\(\{ server: window\.location\.origin, token: body\.token, workspace: data\.workspace, state \}\)/)
  assert.match(route, /query\.set\("state", deps\.state\)/)
})

await test("server: /connect-extension is never framed, like /oauth/authorize", async () => {
  const server = fs.readFileSync("src/server.ts", "utf8")
  assert.match(server, /url\.pathname === "\/oauth\/authorize" \|\| url\.pathname === "\/connect-extension"/)
  assert.match(server, /return blockFraming\(await handler\.fetch\(request\)\)/)
  const framed = blockFraming(new Response("<p>consent</p>", { status: 200, headers: { "content-type": "text/html", "content-security-policy": "default-src 'self'" } }))
  assert.equal(framed.status, 200)
  assert.equal(framed.headers.get("x-frame-options"), "DENY")
  assert.equal(framed.headers.get("content-security-policy"), "frame-ancestors 'none'")
  assert.equal(framed.headers.get("content-type"), "text/html")
  assert.equal(await framed.text(), "<p>consent</p>")
})

console.log(`\n${passed} passed`)
