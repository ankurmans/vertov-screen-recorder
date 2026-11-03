import fs from "node:fs"
import { chromium } from "playwright-core"
import { PROFILE_DIR, SESSION_FILE, appUrl, chromePath, isLocalOrigin, writePrivate } from "./config"
import { logger } from "./logger"

/**
 * npm run setup           sign in yourself in a dedicated browser window; the session is saved locally (mode 600).
 * npm run setup -- --guest   LOCAL test environments only: create an anonymous guest session.
 * The saved file holds cookies. It lives outside the repository and is never printed or uploaded.
 */
const origin = appUrl()
const guest = process.argv.includes("--guest")

if (guest && !isLocalOrigin(origin)) {
  console.error(`--guest is for local test environments only; ${origin} is not one.`)
  process.exit(2)
}

fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 })
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  executablePath: chromePath(),
  headless: guest,
  viewport: { width: 1280, height: 860 },
  args: ["--no-first-run"],
})

try {
  const page = context.pages()[0] ?? (await context.newPage())
  if (guest) {
    await page.goto(origin, { waitUntil: "domcontentloaded" })
    const status = await page.evaluate(async () => (await fetch("/api/auth/sign-in/anonymous", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)
    if (status >= 400) throw new Error(`The app refused the guest sign-in (${status})`)
  } else {
    await page.goto(`${origin}/signin`, { waitUntil: "domcontentloaded" })
    logger.info("Sign in in the browser window. This window closes by itself once you reach your library (10 minute limit).")
    await page.waitForURL((url) => url.origin === origin && url.pathname.startsWith("/app"), { timeout: 10 * 60_000 })
  }
  await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("load").catch(() => {})
  if (new URL(page.url()).pathname.startsWith("/signin")) throw new Error("Not signed in: the library redirected to the sign-in page")
  const state = await context.storageState()
  writePrivate(SESSION_FILE, JSON.stringify(state))
  logger.info(`Saved the browser session (${state.cookies.length} cookies) to ${SESSION_FILE}`)
} finally {
  await context.close()
}
