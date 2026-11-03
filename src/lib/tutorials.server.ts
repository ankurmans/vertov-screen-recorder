import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { Workspace } from "@/db/schema"
import type { SessionUser } from "@/lib/auth.server"
import type { z } from "zod"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import { audit } from "@/lib/audit.server"
import { getUploadById } from "@/lib/uploads.server"
import { parseZooms } from "@/lib/zooms"
import { parseStyle } from "@/lib/stage"
import { startJobSchema } from "@/lib/tutorials/jobs"
import type { completeSchema, TutorialJob } from "@/lib/tutorials/jobs"
import { bindRecipe, estimateSeconds, resolveParameters, wordCount } from "@/lib/tutorials/recipe"
import type { Recipe } from "@/lib/tutorials/recipe"
import { recipeById, recipes } from "@/lib/tutorials/recipes"
import * as queue from "@/lib/tutorials/queue"

const handle = () => env.DB as unknown as queue.Db

export function recipeSummary(recipe: Recipe) {
  const script = recipe.steps.map((step) => step.narration).join(" ")
  return {
    id: recipe.id,
    version: recipe.version,
    title: recipe.title,
    summary: recipe.summary,
    preconditions: recipe.preconditions,
    parameters: recipe.parameters,
    steps: recipe.steps.map((step) => ({ id: step.id, goal: step.goal, narration: step.narration, seconds: Math.round(estimateSeconds(step.narration) + step.hold) })),
    words: wordCount(script),
    estimatedSeconds: Math.round(recipe.steps.reduce((total, step) => total + Math.max(estimateSeconds(step.narration) + 1, 4) + step.hold, 0)),
  }
}

export const listRecipes = () => recipes.map(recipeSummary)

export async function startJob(user: SessionUser, workspace: Workspace, input: unknown): Promise<{ ok: true; job: TutorialJob } | { ok: false; error: string; status: number }> {
  const parsed = startJobSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Send {\"recipeId\": \"…\", \"parameters\": {…}}", status: 400 }
  const recipe = recipeById(parsed.data.recipeId)
  if (!recipe) return { ok: false, error: "Unknown tutorial recipe", status: 404 }
  const values = resolveParameters(recipe, parsed.data.parameters)
  if (!values.ok) return { ok: false, error: values.error, status: 400 }
  const id = `tj_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`
  await queue.createJob(handle(), { id, workspaceId: workspace.id, userId: user.sub, recipeId: recipe.id, recipeVersion: recipe.version, title: recipe.title, parameters: values.values, presenter: Boolean(parsed.data.presenter) })
  await audit(workspace.id, user.sub, "tutorial.start", id, recipe.id)
  const row = await queue.getJob(handle(), workspace.id, id)
  return { ok: true, job: queue.toJob(row!) }
}

export async function jobsFor(workspaceId: string, origin: string) {
  const [rows, runnerOnline] = await Promise.all([queue.listJobs(handle(), workspaceId), queue.runnerOnline(handle(), workspaceId)])
  return { runnerOnline, jobs: rows.map((row) => queue.toJob(row, origin)) }
}

export async function jobFor(workspaceId: string, id: string, origin: string): Promise<TutorialJob | null> {
  const row = await queue.getJob(handle(), workspaceId, id)
  return row ? queue.toJob(row, origin) : null
}

export const cancel = (workspaceId: string, id: string) => queue.cancelJob(handle(), workspaceId, id)

/** The next job for this workspace's runner, with the recipe already bound to the job's parameters. */
export async function claim(workspaceId: string, runnerId: string, origin: string) {
  const row = await queue.claimNext(handle(), workspaceId, runnerId)
  if (!row) return null
  const recipe = recipeById(row.recipe_id)
  if (!recipe || recipe.version !== row.recipe_version) {
    await queue.failJob(handle(), workspaceId, row.id, runnerId, { error: "This recipe version is no longer available", retryable: false })
    return null
  }
  return { job: queue.toJob(row, origin), recipe: bindRecipe(recipe, queue.toJob(row, origin).parameters) }
}

export const progress = (workspaceId: string, id: string, runnerId: string, body: Parameters<typeof queue.reportProgress>[4]) => queue.reportProgress(handle(), workspaceId, id, runnerId, body)
export const fail = (workspaceId: string, id: string, runnerId: string, body: Parameters<typeof queue.failJob>[4]) => queue.failJob(handle(), workspaceId, id, runnerId, body)

/** Evenly spaced word timings inside each cue, so caption styles and edit-by-text work on narration cues. */
function transcriptFromCues(cues: Array<{ start: number; end: number; text: string }>) {
  const words = cues.flatMap((cue) => {
    const parts = cue.text.split(/\s+/).filter(Boolean)
    const span = Math.max(cue.end - cue.start, 0.1) / Math.max(parts.length, 1)
    return parts.map((text, index) => ({ text, start: cue.start + index * span, end: cue.start + (index + 1) * span }))
  })
  return { cues, words }
}

/**
 * Finishes a job once the runner has uploaded the recording through /api/v1/videos. The video must be in this workspace;
 * it stays workspace-only until someone reviews it. Zooms and narration cues go through the same parsers the editor uses.
 */
export async function complete(workspaceId: string, id: string, runnerId: string, body: z.infer<typeof completeSchema>, origin: string) {
  const row = await queue.getJob(handle(), workspaceId, id)
  if (!row) return { ok: false as const, status: 404, error: "Job not found" }
  const upload = await getUploadById(body.videoId)
  if (!upload || upload.workspaceId !== workspaceId) return { ok: false as const, status: 400, error: "That video isn't in this workspace" }
  const result = await queue.completeJob(handle(), workspaceId, id, runnerId, { videoId: body.videoId, verified: body.verified })
  if (!result.ok) return { ok: false as const, status: result.reason === "not_found" ? 404 : 409, error: `Job can't be completed (${result.reason})` }
  if (!result.already) {
    const zooms = parseZooms(body.zooms)
    const style = parseStyle(upload.style)
    const changes: Partial<typeof uploads.$inferInsert> = { visibility: "workspace", title: row.title, captureSurface: "agent" }
    if (zooms.length) changes.style = JSON.stringify({ ...style, zooms })
    if (body.cues?.length) {
      const key = `uploads/${upload.id}/transcript.json`
      const transcript = transcriptFromCues(body.cues)
      await env.BUCKET.put(key, JSON.stringify(transcript), { httpMetadata: { contentType: "application/json" } })
      Object.assign(changes, { transcriptKey: key, language: "en", transcriptText: body.cues.map((cue) => cue.text).join(" ").slice(0, 100_000), audioKey: null, aiStatus: "done" })
    }
    await db.update(uploads).set(changes).where(eq(uploads.id, upload.id))
  }
  const fresh = await queue.getJob(handle(), workspaceId, id)
  return { ok: true as const, job: queue.toJob(fresh!, origin) }
}
