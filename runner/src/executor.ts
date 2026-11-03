import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright-core"
import type { Browser, BrowserContext, Page } from "playwright-core"
import type { Action, Expectation, Recipe } from "../../src/lib/tutorials/recipe"
import { chromePath } from "./config"
import { describeLocator, resolveLocator } from "./locators"
import {
  CLICK_PAUSE_MS,
  EXPECT_TIMEOUT_MS,
  LEAD_IN_MS,
  LEAD_MS,
  MOUSE_MS,
  MOUSE_STEPS,
  TAIL_MS,
  TYPE_DELAY_MS,
  WAIT_TIMEOUT_MS,
  percentFor,
  stepEndMs,
  urlMatches,
} from "./pacing"
import { allowRequest, resolveInScope } from "./scope"
import type { ClickPoint, ExecutionResult, NarrationPlan, ProgressFn, StepResult } from "./types"

export const VIEWPORT = { width: 1920, height: 1080 }

/** A step did not do what the recipe says it should. The run stops; nothing is reported as demonstrated. */
export class StepFailure extends Error {
  constructor(
    message: string,
    readonly stepId: string,
    readonly screenshotPath?: string,
    readonly videoPath?: string,
  ) {
    super(message)
    this.name = "StepFailure"
  }
}

export class CancelledError extends Error {
  constructor(readonly reason: "cancelled" | "shutdown" = "cancelled") {
    super(reason === "shutdown" ? "The runner is shutting down" : "Cancelled")
    this.name = "CancelledError"
  }
}

export interface ExecuteArgs {
  recipe: Recipe
  narration: NarrationPlan
  sessionFile: string
  appUrl: string
  workdir: string
  onProgress: ProgressFn
  signal?: AbortSignal
  /** Show the browser window (development). */
  headed?: boolean
}

// A visible pointer for the recording: headless Chrome does not draw the real cursor.
const CURSOR_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById('__vertov_cursor')) return
    const dot = document.createElement('div')
    dot.id = '__vertov_cursor'
    dot.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(220,38,38,.85);border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transition:transform .08s ease-out'
    document.documentElement.appendChild(dot)
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)' }, true)
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)' }, true)
  }
  if (document.documentElement) install(); else addEventListener('DOMContentLoaded', install)
})()`

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function execute(args: ExecuteArgs): Promise<ExecutionResult> {
  const { recipe, narration, appUrl, workdir, onProgress, signal } = args
  if (!fs.existsSync(args.sessionFile)) throw new Error("No saved browser session. Run `npm run setup` first.")
  fs.mkdirSync(workdir, { recursive: true })
  // A fresh folder per execution: an interrupted earlier attempt may have left a partial recording in this job's workdir.
  const videoDir = path.join(workdir, `video-${Date.now()}`)
  fs.mkdirSync(videoDir, { recursive: true })
  const origin = new URL(appUrl).origin

  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  const results: Array<StepResult> = []
  const clicks: Array<ClickPoint> = []
  let t0 = 0
  const now = () => Math.round(performance.now() - t0)
  let mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }
  let failure: Error | undefined
  let durationMs = 0

  const checkCancel = () => {
    if (signal?.aborted) throw new CancelledError(signal.reason === "shutdown" ? "shutdown" : "cancelled")
  }

  try {
    browser = await chromium.launch({ executablePath: chromePath(), headless: !args.headed, args: ["--force-device-scale-factor=1", "--hide-scrollbars"] })
    context = await browser.newContext({
      storageState: args.sessionFile,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: { dir: videoDir, size: VIEWPORT },
    })
    await context.addInitScript(CURSOR_SCRIPT)
    await context.route("**/*", (route) => {
      const request = route.request()
      // Blocked navigations are aborted, so a step that tries to leave the app fails its expectation rather than succeeding elsewhere.
      return allowRequest(origin, request.url(), request.resourceType(), request.isNavigationRequest()) ? route.continue() : route.abort("blockedbyclient")
    })
    page = await context.newPage()
    t0 = performance.now()
    context.on("page", (extra) => {
      if (extra !== page) void extra.close().catch(() => {})
    })
    // Recording begins here, so show a neutral frame rather than a blank white one while the lead-in runs.
    await page.setContent('<body style="margin:0;background:#fafaf9"></body>')
    await sleep(LEAD_IN_MS)

    const move = async (x: number, y: number) => {
      const from = mouse
      for (let i = 1; i <= MOUSE_STEPS; i++) {
        const k = i / MOUSE_STEPS
        const eased = k * k * (3 - 2 * k)
        await page!.mouse.move(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased)
        await sleep(MOUSE_MS / MOUSE_STEPS)
      }
      mouse = { x, y }
    }

    const pointAt = async (locator: ReturnType<typeof resolveLocator>) => {
      await locator.waitFor({ state: "visible", timeout: WAIT_TIMEOUT_MS })
      await locator.scrollIntoViewIfNeeded()
      const box = await locator.boundingBox()
      if (!box) throw new Error("it has no position on the page")
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    }

    const clickAt = async (locator: ReturnType<typeof resolveLocator>) => {
      const point = await pointAt(locator)
      await move(point.x, point.y)
      await sleep(CLICK_PAUSE_MS)
      clicks.push({ tMs: now(), x: Math.min(1, Math.max(0, point.x / VIEWPORT.width)), y: Math.min(1, Math.max(0, point.y / VIEWPORT.height)) })
      await page!.mouse.click(point.x, point.y)
    }

    const run = async (action: Action) => {
      switch (action.type) {
        case "goto":
          await page!.goto(resolveInScope(origin, action.path), { waitUntil: "domcontentloaded" })
          await page!.waitForLoadState("load", { timeout: 10_000 }).catch(() => {})
          break
        case "click":
          await clickAt(resolveLocator(page!, action.target))
          break
        case "fill": {
          const locator = resolveLocator(page!, action.target)
          await clickAt(locator)
          await locator.fill("")
          await page!.keyboard.type(action.value, { delay: TYPE_DELAY_MS })
          break
        }
        case "scroll": {
          if (action.target) {
            const point = await pointAt(resolveLocator(page!, action.target))
            await move(point.x, point.y)
          }
          const sign = action.direction === "down" ? 1 : -1
          for (let i = 0; i < 10; i++) {
            await page!.mouse.wheel(0, (sign * action.amount) / 10)
            await sleep(40)
          }
          break
        }
        case "wait":
          await resolveLocator(page!, action.until).waitFor({ state: "visible", timeout: WAIT_TIMEOUT_MS })
          break
        case "pause":
          await sleep(action.seconds * 1000)
          break
      }
    }

    const verify = async (expectation: Expectation) => {
      if (expectation.type === "url") {
        await page!.waitForURL((url) => urlMatches(url.toString(), expectation.path), { timeout: EXPECT_TIMEOUT_MS })
        return
      }
      const locator = resolveLocator(page!, expectation.target)
      await locator.first().waitFor({ state: expectation.type === "visible" ? "visible" : "hidden", timeout: EXPECT_TIMEOUT_MS })
    }

    const describeExpectation = (expectation: Expectation) =>
      expectation.type === "url" ? `the page to be at ${expectation.path}` : `${describeLocator(expectation.target)} to be ${expectation.type}`

    for (const [index, step] of recipe.steps.entries()) {
      checkCancel()
      const plan = narration.steps.find((entry) => entry.stepId === step.id)
      if (!plan) throw new Error(`No narration prepared for step ${step.id}`)
      const progress = await onProgress({ stage: "recording", step: step.id, message: step.goal, percent: percentFor(index, recipe.steps.length) })
      if (progress.cancel) throw new CancelledError("cancelled")

      await sleep(LEAD_MS)
      const startMs = now()
      let phase = "do"
      let detail = ""
      try {
        for (const action of step.actions) {
          checkCancel()
          detail = action.type === "goto" ? action.path : "target" in action && action.target ? describeLocator(action.target) : action.type
          await run(action)
        }
        phase = "expect"
        await onProgress({ stage: "verifying", step: step.id, message: `Checking: ${step.goal}`, percent: percentFor(index, recipe.steps.length) })
        for (const expectation of step.expect) {
          checkCancel()
          detail = describeExpectation(expectation)
          await verify(expectation)
        }
      } catch (error) {
        if (error instanceof CancelledError) throw error
        const screenshotPath = path.join(workdir, `failure-${step.id}.png`)
        await page.screenshot({ path: screenshotPath }).catch(() => {})
        const reason = phase === "expect" ? `expected ${detail}` : `could not ${step.actions.find((a) => a.type === "click" || a.type === "fill") ? "act on" : "do"} ${detail}`
        throw new StepFailure(`Step ${step.id}: ${reason}`, step.id, screenshotPath)
      }
      const actionsEndMs = now()
      const endMs = stepEndMs({ startMs, narrationSeconds: plan.seconds, actionsEndMs, holdSeconds: step.hold })
      const wait = endMs - now()
      if (wait > 0) await sleep(wait)
      results.push({ stepId: step.id, startMs, actionsEndMs, endMs: Math.max(endMs, now()), verified: step.expect.length > 0, note: step.expect.length > 0 ? undefined : "No expected result was checked" })
    }
    await sleep(TAIL_MS)
    durationMs = now()
  } catch (error) {
    failure = error as Error
  } finally {
    // Closing the context finalizes the video file.
    await page?.close().catch(() => {})
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }

  const videoPath = await findVideo(videoDir)
  if (failure) {
    if (failure instanceof StepFailure) throw new StepFailure(failure.message, failure.stepId, failure.screenshotPath, videoPath)
    throw failure
  }
  if (!videoPath) throw new Error("The browser did not produce a recording")
  return { videoPath, width: VIEWPORT.width, height: VIEWPORT.height, durationMs, steps: results, clicks }
}

async function findVideo(dir: string): Promise<string | undefined> {
  const file = fs.readdirSync(dir).find((name) => name.endsWith(".webm"))
  return file ? path.join(dir, file) : undefined
}

