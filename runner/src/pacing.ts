export const LEAD_MS = 600
export const LEAD_IN_MS = 1500
export const TAIL_MS = 1500
export const NARRATION_PAD_MS = 400
export const MOUSE_STEPS = 12
export const MOUSE_MS = 600
export const CLICK_PAUSE_MS = 500
export const TYPE_DELAY_MS = 45
/** Overridable so tests of a failing expectation do not wait the full eight seconds. */
export const EXPECT_TIMEOUT_MS = Number(process.env.VERTOV_EXPECT_TIMEOUT_MS) || 8000
export const WAIT_TIMEOUT_MS = 10000

/**
 * When the next step may begin: after the narration finishes, and after the result has been on screen for the step's hold.
 * Never earlier, so the narration is not cut off and a fast browser doesn't rush the viewer.
 */
export function stepEndMs(input: { startMs: number; narrationSeconds: number; actionsEndMs: number; holdSeconds: number }): number {
  return Math.max(input.startMs + input.narrationSeconds * 1000 + NARRATION_PAD_MS, input.actionsEndMs + input.holdSeconds * 1000)
}

export const percentFor = (stepIndex: number, stepCount: number) => Math.round(((stepIndex + 0.0) / Math.max(1, stepCount)) * 100)

/** Whether a path expectation holds: a path without a query compares only the pathname. */
export function urlMatches(actual: string, expectedPath: string): boolean {
  const url = new URL(actual)
  return expectedPath.includes("?") ? `${url.pathname}${url.search}` === expectedPath : url.pathname === expectedPath
}
