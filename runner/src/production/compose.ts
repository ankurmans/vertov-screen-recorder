import { fileURLToPath } from "node:url"
import { access, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { ClickPoint, ExecutionResult, NarrationPlan, ProducedVideo, Recipe, RunnerLogger } from "../types"
import { probeSeconds, run } from "./media"
import { captionsFromCues, renderCaptionImages } from "./captions"

/** Zoom limits mirror parseZooms in src/lib/zooms.ts, which clamps whatever it is given. */
const ZOOM_LEAD = 0.4
const ZOOM_DURATION = 2.4
const ZOOM_SCALE = 1.6
const ZOOM_SPACING = 3
const MAX_ZOOMS = 12
/** Narration starts slightly before the first action so the viewer hears what is about to happen. */
const AUDIO_LEAD_MS = 300
// Personal presenter assets live beside the repo, never in it; override with TUTORIAL_PRESENTER_PORTRAIT.
const PORTRAIT = fileURLToPath(new URL("../../../../tutorial-assets/ankur/approved-presenter-portrait.png", import.meta.url))
const PRESENTER_SIZE = 256
const PRESENTER_MARGIN = 32

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** Click zooms: one per meaningful click, spaced out, never overlapping, at most a dozen. */
export function deriveZooms(clicks: Array<ClickPoint>, durationSeconds?: number): ProducedVideo["zooms"] {
  const zooms: ProducedVideo["zooms"] = []
  let lastClick = -Infinity
  for (const click of [...clicks].sort((a, b) => a.tMs - b.tMs)) {
    if (zooms.length >= MAX_ZOOMS) break
    if (![click.tMs, click.x, click.y].every(Number.isFinite) || click.tMs < 0) continue
    const seconds = click.tMs / 1000
    if (seconds - lastClick < ZOOM_SPACING) continue
    const start = Math.max(0, seconds - ZOOM_LEAD)
    const previous = zooms.at(-1)
    if (previous && start < previous.start + previous.duration) continue
    if (durationSeconds !== undefined && start + ZOOM_DURATION > durationSeconds) continue
    zooms.push({ id: `zoom-${zooms.length}`, start: Number(start.toFixed(3)), duration: ZOOM_DURATION, x: clamp(click.x, 0, 1), y: clamp(click.y, 0, 1), scale: ZOOM_SCALE })
    lastClick = seconds
  }
  return zooms
}

const exists = (path: string) => access(path).then(() => true, () => false)

export async function produce(input: {
  execution: ExecutionResult
  narration: NarrationPlan
  recipe: Recipe
  presenter: boolean
  workdir: string
  logger: RunnerLogger
}): Promise<ProducedVideo> {
  const { execution, narration, workdir, logger } = input
  const outDir = join(workdir, "output")
  await mkdir(outDir, { recursive: true })
  const output = join(outDir, "tutorial.mp4")

  // Playwright's WebM often has no duration header; fall back to what the executor measured.
  const probed = await probeSeconds(execution.videoPath).catch(() => null)
  const recorded = probed ?? execution.durationMs / 1000
  const total = Math.max(recorded, 0.5)

  const starts = new Map(execution.steps.map((step) => [step.stepId, step.startMs]))
  const timed = narration.steps.flatMap((step) => {
    const startMs = starts.get(step.stepId)
    if (startMs === undefined || !step.audioPath) return []
    return [{ step, start: Math.max(0, startMs - AUDIO_LEAD_MS) / 1000 }]
  })

  let portrait: string | null = null
  if (input.presenter) {
    const path = process.env.TUTORIAL_PRESENTER_PORTRAIT ?? PORTRAIT
    if (await exists(path)) portrait = path
    else logger.warn(`Presenter portrait not found at ${path}; producing a screen-only tutorial`)
  }

  const args = ["-y", "-v", "error", "-i", execution.videoPath]
  let next = 1
  const audioLabels: Array<string> = []
  const filters: Array<string> = []

  filters.push("[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=30,format=yuv420p[base]")
  let videoLabel = "base"
  if (portrait) {
    args.push("-loop", "1", "-framerate", "30", "-i", portrait)
    const index = next++
    const size = PRESENTER_SIZE
    // A still portrait, cropped square and masked to a circle. It does not move or lip-sync.
    filters.push(
      `[${index}:v]scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2),255,0)'[circle]`,
      `[base][circle]overlay=W-w-${PRESENTER_MARGIN}:H-h-${PRESENTER_MARGIN}:shortest=1,format=yuv420p[composed]`,
    )
    videoLabel = "composed"
  }

  const cues = timed.map(({ step, start }) => ({ start: Number(start.toFixed(3)), end: Number((start + step.seconds).toFixed(3)), text: step.text }))
  const captions = process.env.TUTORIAL_CAPTIONS === "0" ? [] : captionsFromCues(cues)
  if (captions.length) {
    const images = await renderCaptionImages(captions, join(workdir, "captions"))
    for (const [i, image] of images.entries()) {
      args.push("-loop", "1", "-framerate", "30", "-i", image)
      const index = next++
      const out = `cap${i}`
      filters.push(`[${videoLabel}][${index}:v]overlay=0:0:shortest=1:enable='between(t,${captions[i].start},${captions[i].end})'[${out}]`)
      videoLabel = out
    }
  }

  // A silent bed spans the whole video so the mix is always full length and the MP4 always has audio.
  args.push("-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo")
  filters.push(`[${next++}:a]aformat=sample_rates=44100:channel_layouts=stereo[bed]`)
  audioLabels.push("[bed]")
  for (const [i, item] of timed.entries()) {
    args.push("-i", item.step.audioPath as string)
    const delay = Math.round(item.start * 1000)
    filters.push(`[${next++}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${delay}|${delay}[n${i}]`)
    audioLabels.push(`[n${i}]`)
  }
  filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(3)},asetpts=N/SR/TB[mix]`)

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`, "-map", "[mix]",
    "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-movflags", "+faststart",
    output,
  )
  logger.info(`Composing ${timed.length} narration clip(s), ${captions.length} caption(s)${portrait ? " with the presenter portrait" : ""}`)
  await run("ffmpeg", args)

  const durationSeconds = await probeSeconds(output)
  return { path: output, durationSeconds, cues, zooms: deriveZooms(execution.clicks, durationSeconds) }
}
