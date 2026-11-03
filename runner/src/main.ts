import * as api from "./api"
import { appUrl, jobDir, runnerId } from "./config"
import { CancelledError, StepFailure } from "./executor"
import { logger } from "./logger"
import { cleanIntermediates, runPipeline } from "./pipeline"
import type { ProgressFn } from "./types"

const POLL_MS = 5000
const HEARTBEAT_MS = 15_000

const id = runnerId()
let shuttingDown = false
let active: AbortController | null = null

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(130)
    shuttingDown = true
    logger.warn(`${signal} received; stopping the current job`)
    active?.abort("shutdown")
  })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function handle(claimed: api.Claim) {
  const { job, recipe } = claimed
  const workdir = jobDir(job.id)
  const controller = new AbortController()
  active = controller
  logger.info(`Claimed job ${job.id}: ${job.title} (attempt ${job.attempts})`)

  let latest: Parameters<ProgressFn>[0] = { stage: "preparing", message: "Runner started" }
  const progress: ProgressFn = async (next) => {
    latest = next
    try {
      const reply = await api.progress(job.id, { runnerId: id, ...next })
      if (reply.cancel && !controller.signal.aborted) controller.abort("cancelled")
      return { cancel: reply.cancel }
    } catch (error) {
      // A missed report is not fatal; the claim lasts two minutes. Losing the claim is.
      if (error instanceof api.ApiError && (error.status === 409 || error.status === 404 || error.status === 403)) controller.abort("lost")
      logger.warn(`Progress report failed: ${(error as Error).message}`)
      return { cancel: controller.signal.aborted }
    }
  }
  const heartbeat = setInterval(() => void progress(latest), HEARTBEAT_MS)

  try {
    const result = await runPipeline({ jobId: job.id, title: job.title, recipe, presenter: job.presenter, workdir, progress, signal: controller.signal, logger, upload: true })
    if (!result.payload) throw new Error("The upload finished without a video id")
    await api.complete(job.id, { runnerId: id, ...result.payload })
    logger.info(`Done: ${result.videoUrl ?? result.payload.videoId}`)
    cleanIntermediates(workdir, [result.produced.path])
  } catch (error) {
    await report(job.id, error, controller.signal)
  } finally {
    clearInterval(heartbeat)
    active = null
  }
}

async function report(jobId: string, error: unknown, signal: AbortSignal) {
  const cancelled = error instanceof CancelledError || signal.aborted
  let body: Parameters<typeof api.fail>[1]
  if (signal.reason === "lost") {
    logger.warn("The server no longer lists this runner as the owner; artifacts kept locally")
    return
  }
  if (signal.reason === "shutdown") body = { runnerId: id, error: "The runner was stopped", retryable: true }
  else if (cancelled) body = { runnerId: id, error: "Cancelled", retryable: false }
  else if (error instanceof StepFailure) body = { runnerId: id, error: error.message, stepId: error.stepId, retryable: false }
  else body = { runnerId: id, error: `Runner error: ${(error as Error).message}`.slice(0, 600), retryable: true }
  logger.error(`${jobId} did not finish: ${body.error}`)
  try {
    await api.fail(jobId, body)
  } catch (failure) {
    logger.error(`Could not report the failure (${(failure as Error).message}); artifacts kept in the job folder`)
  }
}

async function main() {
  logger.info(`Vertov tutorial runner ${id} polling ${appUrl()}`)
  while (!shuttingDown) {
    try {
      const claimed = await api.claim(id)
      if (claimed) {
        await handle(claimed)
        continue
      }
    } catch (error) {
      logger.warn(`Could not reach Vertov: ${(error as Error).message}`)
    }
    await sleep(POLL_MS)
  }
  logger.info("Stopped")
}

void main()
