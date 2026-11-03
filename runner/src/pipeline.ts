import fs from "node:fs"
import path from "node:path"
import type { Recipe } from "../../src/lib/tutorials/recipe"
import { appUrl, SESSION_FILE } from "./config"
import { CancelledError, execute } from "./executor"
import { prepareNarration } from "./production/narration"
import { produce } from "./production/compose"
import { uploadVideo } from "./production/upload"
import type { NarrationPlan, ProducedVideo, ProgressFn, RunnerLogger } from "./types"

/** What the server needs to finish a job; saved before it is sent so a retry never records or uploads twice. */
export interface CompletePayload {
  videoId: string
  verified: Array<{ step: string; verified: boolean; note?: string }>
  zooms: ProducedVideo["zooms"]
  cues: ProducedVideo["cues"]
  narration: { voice: string; wpm: number; synthesized: boolean }
}

interface RunState {
  jobId: string
  produced?: ProducedVideo
  verified?: CompletePayload["verified"]
  narration?: CompletePayload["narration"]
  videoId?: string
  videoUrl?: string
}

const stateFile = (workdir: string) => path.join(workdir, "run.json")
export function readState(workdir: string): RunState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(workdir), "utf8")) as RunState
  } catch {
    return null
  }
}
export const writeState = (workdir: string, state: RunState) => fs.writeFileSync(stateFile(workdir), JSON.stringify(state, null, 2))

export interface PipelineArgs {
  jobId: string
  title: string
  recipe: Recipe
  presenter: boolean
  workdir: string
  progress: ProgressFn
  signal?: AbortSignal
  logger: RunnerLogger
  /** Stop after producing the MP4 (development). */
  upload: boolean
  headed?: boolean
}

export interface PipelineResult {
  produced: ProducedVideo
  payload?: CompletePayload
  videoUrl?: string
}

/** narrate -> record -> produce -> upload. Each finished stage is remembered in run.json, so a retry resumes instead of repeating it. */
export async function runPipeline(args: PipelineArgs): Promise<PipelineResult> {
  const { recipe, workdir, logger } = args
  fs.mkdirSync(workdir, { recursive: true })
  const state: RunState = readState(args.workdir) ?? { jobId: args.jobId }

  if (state.videoId && state.produced && state.verified && state.narration) {
    logger.info(`Already uploaded as ${state.videoId}; skipping straight to completion`)
    return { produced: state.produced, videoUrl: state.videoUrl, payload: payloadOf(state) }
  }

  if (!state.produced || !fs.existsSync(state.produced.path)) {
    await args.progress({ stage: "narrating", message: "Preparing narration" })
    const narration: NarrationPlan = await prepareNarration(recipe, { workdir, presenter: args.presenter, logger })
    logger.info(`Narration ready: ${narration.steps.length} segments, ${narration.wpm} wpm, ${narration.synthesized ? "synthesized" : "silent"}`)

    const execution = await execute({ recipe, narration, sessionFile: SESSION_FILE, appUrl: appUrl(), workdir, onProgress: args.progress, signal: args.signal, headed: args.headed })
    state.verified = execution.steps.map((step) => ({ step: step.stepId, verified: step.verified, note: step.note }))
    state.narration = { voice: narration.voice, wpm: narration.wpm, synthesized: narration.synthesized }

    if (args.signal?.aborted) throw new CancelledError()
    await args.progress({ stage: "producing", message: "Composing the video" })
    state.produced = await produce({ execution, narration, recipe, presenter: args.presenter, workdir, logger })
    writeState(workdir, state)
    logger.info(`Produced ${state.produced.path} (${state.produced.durationSeconds.toFixed(1)}s)`)
  }

  if (!args.upload) return { produced: state.produced }

  await args.progress({ stage: "uploading", message: "Uploading to Vertov" })
  const uploaded = await uploadVideo({ produced: state.produced, title: args.title })
  // Remember the video before telling the server, so a failed completion call is retried without uploading again.
  state.videoId = uploaded.id
  state.videoUrl = uploaded.url
  writeState(workdir, state)
  return { produced: state.produced, videoUrl: uploaded.url, payload: payloadOf(state) }
}

function payloadOf(state: RunState): CompletePayload {
  return { videoId: state.videoId!, verified: state.verified!, zooms: state.produced!.zooms, cues: state.produced!.cues, narration: state.narration! }
}

/** After a successful job: keep the final MP4 and run.json for review, drop the large intermediates. */
export function cleanIntermediates(workdir: string, keep: string[]) {
  const keepSet = new Set(keep.map((file) => path.resolve(file)).concat(path.resolve(stateFile(workdir))))
  const visit = (dir: string): boolean => {
    let empty = true
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (visit(full)) fs.rmdirSync(full)
        else empty = false
      } else if (keepSet.has(path.resolve(full))) empty = false
      else fs.rmSync(full, { force: true })
    }
    return empty
  }
  visit(workdir)
}
