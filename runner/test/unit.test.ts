import assert from "node:assert/strict"
import { test } from "node:test"
import { locatorSchema } from "../../src/lib/tutorials/recipe"
import { describeLocator, planLocator } from "../src/locators"
import { LEAD_MS, NARRATION_PAD_MS, stepEndMs, urlMatches } from "../src/pacing"
import { allowRequest, resolveInScope } from "../src/scope"

const loc = (value: unknown) => locatorSchema.parse(value)

test("locators translate to accessible Playwright calls", () => {
  assert.deepEqual(planLocator(loc({ role: "button", name: "Create space", exact: true })), { kind: "role", role: "button", value: "Create space", exact: true, within: undefined, nth: undefined })
  assert.equal(planLocator(loc({ label: "Space name" })).kind, "label")
  assert.equal(planLocator(loc({ text: "Give this space its first video." })).kind, "text")
  assert.equal(planLocator(loc({ testId: "move" })).kind, "testId")
  assert.equal(planLocator(loc({ css: "ul > li" })).kind, "css")
  const scoped = planLocator(loc({ role: "button", name: "Move", within: { role: "dialog" }, nth: 1 }))
  assert.deepEqual(scoped.within, { role: "dialog" })
  assert.equal(scoped.nth, 1)
})

test("a locator with no strategy is refused, and so is one with two", () => {
  assert.equal(locatorSchema.safeParse({}).success, false)
  assert.equal(locatorSchema.safeParse({ role: "button", label: "x" }).success, false)
  assert.throws(() => planLocator({} as never))
})

test("locators read well in failure messages", () => {
  assert.equal(describeLocator(loc({ role: "dialog", name: "Create a space" })), "“Create a space” dialog")
  assert.equal(describeLocator(loc({ role: "button", name: "Move", within: { role: "dialog" } })), "“Move” button in the dialog")
})

test("goto paths cannot leave the app", () => {
  const app = "http://localhost:3000"
  assert.equal(resolveInScope(app, "/app"), "http://localhost:3000/app")
  assert.equal(resolveInScope(app, "/app?view=archive"), "http://localhost:3000/app?view=archive")
  for (const bad of ["//evil.example/", "https://evil.example/", "app", "/\\evil.example", "\\\\evil", "/a\u0000b", "javascript:alert(1)"]) assert.throws(() => resolveInScope(app, bad), /Refusing path/, bad)
})

test("only documents and navigations are held to the app origin", () => {
  const app = "http://localhost:3000"
  assert.equal(allowRequest(app, "http://localhost:3000/app", "document", true), true)
  assert.equal(allowRequest(app, "https://evil.example/", "document", true), false)
  assert.equal(allowRequest(app, "https://evil.example/frame", "document", false), false)
  assert.equal(allowRequest(app, "https://fonts.gstatic.com/x.woff2", "font", false), true)
  assert.equal(allowRequest(app, "data:text/html,hi", "document", true), true)
  assert.equal(allowRequest(app, "blob:http://localhost:3000/abc", "image", false), true)
  assert.equal(allowRequest(app, "file:///etc/passwd", "document", true), false)
  assert.equal(allowRequest(app, "not a url", "document", true), false)
})

test("a step never ends before its narration or before the result has been held", () => {
  // Narration is the long pole: 10s of speech starting at 5s.
  assert.equal(stepEndMs({ startMs: 5000, narrationSeconds: 10, actionsEndMs: 7000, holdSeconds: 1.5 }), 5000 + 10_000 + NARRATION_PAD_MS)
  // Actions are the long pole: the hold counts from when the actions finished.
  assert.equal(stepEndMs({ startMs: 5000, narrationSeconds: 2, actionsEndMs: 12_000, holdSeconds: 3 }), 15_000)
  assert.ok(LEAD_MS > 0)
})

test("url expectations compare the pathname unless the expectation has a query", () => {
  assert.equal(urlMatches("http://x/app?view=space", "/app"), true)
  assert.equal(urlMatches("http://x/app?view=space", "/app?view=space"), true)
  assert.equal(urlMatches("http://x/app?view=archive", "/app?view=space"), false)
  assert.equal(urlMatches("http://x/other", "/app"), false)
})
