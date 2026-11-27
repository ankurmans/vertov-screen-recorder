// Password creation and reset against a LOCAL worker: the password exists only after an email link proved the mailbox, signing in with it
// works, replacing it needs a fresh session, and a replacement signs other sessions out. Magic links are read from the worker's log.
// Start: npm run build && npm run local:migrate && npm run local > worker.log 2>&1
// Run: BASE=http://localhost:8787 WORKER_LOG=worker.log npx tsx scripts/test-set-password.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import { execFileSync } from "node:child_process"

const BASE = process.env.BASE ?? "http://localhost:8787"
const LOG = process.env.WORKER_LOG
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("Local worker only.")
if (!LOG) throw new Error("Set WORKER_LOG to the local worker's log file.")

let passed = 0
const check = (name) => {
  passed += 1
  console.log(`PASS ${name}`)
}
const email = `pw-${Date.now()}@example.com`
const PASSWORD = "correct horse battery"
const json = { "content-type": "application/json", origin: BASE }

const jar = () => {
  const cookies = new Map()
  return {
    take(response) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";")
        const [name, ...rest] = pair.split("=")
        if (rest.join("=") === "") cookies.delete(name)
        else cookies.set(name, rest.join("="))
      }
    },
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  }
}

async function emailLink(callbackURL) {
  const before = fs.readFileSync(LOG, "utf8").length
  const response = await fetch(`${BASE}/api/auth/sign-in/magic-link`, { method: "POST", headers: json, body: JSON.stringify({ email, callbackURL }) })
  assert.equal(response.status, 200, "link requested")
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(LOG, "utf8").slice(before)
    const match = log.match(new RegExp(`\\[magic link for ${email.replace(/[.+]/g, "\\$&")}\\] (\\S+)`))
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("no magic link in the worker log")
}

async function signInByLink(callbackURL) {
  const cookies = jar()
  const response = await fetch(await emailLink(callbackURL), { redirect: "manual" })
  cookies.take(response)
  assert.ok(cookies.header(), "link signed the browser in")
  return cookies
}

const setPassword = (cookies, password) =>
  fetch(`${BASE}/api/account/password`, { method: "POST", headers: { ...json, cookie: cookies.header() }, body: JSON.stringify({ password }) })

const passwordLogin = async (password) => {
  const cookies = jar()
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) })
  cookies.take(response)
  return { status: response.status, cookies }
}

// 1. A brand-new address cannot get an account with a password: public password sign-up stays closed.
const open = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: json, body: JSON.stringify({ email, password: PASSWORD, name: "x" }) })
assert.notEqual(open.status, 200, "public password sign-up is closed")
check("public password sign-up stays closed")
assert.notEqual((await passwordLogin(PASSWORD)).status, 200)
check("no password login before one is chosen")

// 2. A signed-out request cannot set one; a guest (anonymous) session cannot either.
assert.equal((await fetch(`${BASE}/api/account/password`, { method: "POST", headers: json, body: JSON.stringify({ password: PASSWORD }) })).status, 401)
check("signed-out request refused")
const guest = jar()
guest.take(await fetch(`${BASE}/api/auth/sign-in/anonymous`, { method: "POST", headers: json, body: "{}" }))
assert.equal((await setPassword(guest, PASSWORD)).status, 403)
check("guest session refused until the email is confirmed")

// 3. The email link proves the mailbox; then a password can be chosen, with length rules and a same-as-email check.
const first = await signInByLink("/set-password?redirect=%2F")
assert.equal((await setPassword(first, "short")).status, 400)
assert.equal((await setPassword(first, "x".repeat(129))).status, 400)
assert.equal((await setPassword(first, email)).status, 400)
check("too short, too long and password-equals-email refused")
const saved = await setPassword(first, PASSWORD)
assert.equal(saved.status, 200, await saved.clone().text())
check("password saved after the email link")

// 4. Signing in with it works; a wrong one does not.
assert.equal((await passwordLogin(PASSWORD)).status, 200)
assert.notEqual((await passwordLogin(PASSWORD + "!")).status, 200)
check("password sign-in works, a wrong password does not")

// 5. The page redirects signed-out visitors to sign-in and renders for signed-in ones.
const page = await fetch(`${BASE}/set-password`, { redirect: "manual", headers: { cookie: first.header() } })
assert.equal(page.status, 200)
assert.match(await page.text(), /Choose a password/)
const anonPage = await fetch(`${BASE}/set-password`, { redirect: "manual" })
assert.ok([301, 302, 307, 308].includes(anonPage.status) || /signin/.test(await anonPage.text()), "signed-out visitors go to sign-in")
check("set-password page: signed-in renders, signed-out is sent to sign-in")

// 6. Replacing an existing password needs a session under 15 minutes old, and signs the other sessions out.
const loginSession = (await passwordLogin(PASSWORD)).cookies
const ageSessions = () => {
  const sql = `UPDATE session SET createdAt = createdAt - 3600000 WHERE userId = (SELECT id FROM "user" WHERE email = '${email}')`
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/local", "-c", "dist/server/wrangler.json", "--command", sql], { stdio: "pipe" })
}
ageSessions()
const stale = await setPassword(loginSession, "another long password")
assert.equal(stale.status, 403)
check("an old session cannot replace an existing password")
const fresh = await signInByLink("/set-password?redirect=%2F")
const replaced = await setPassword(fresh, "another long password")
assert.equal(replaced.status, 200, await replaced.clone().text())
assert.notEqual((await passwordLogin(PASSWORD)).status, 200)
assert.equal((await passwordLogin("another long password")).status, 200)
check("a fresh email-link session replaces the password; the old one stops working")
const other = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: first.header() } })
assert.equal((await other.text()).includes(email), false, "other sessions are signed out")
check("other sessions signed out after a replacement")

// 7. Repeated attempts are throttled per account and network.
let limited = false
for (let i = 0; i < 8 && !limited; i++) limited = (await setPassword(fresh, email)).status === 429
assert.ok(limited, "attempt limit reached")
check("repeated attempts are throttled")

console.log(`\n${passed} checks passed`)
