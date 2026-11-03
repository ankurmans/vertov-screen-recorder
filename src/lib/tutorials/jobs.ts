import { z } from "zod"

/** The shared shape of a tutorial job, used by the API, the app and the local runner. */

export const JOB_STATES = ["queued", "running", "completed", "failed", "cancelled"] as const
export type JobState = (typeof JOB_STATES)[number]

/** How long a runner owns a job without reporting progress, and how many times a job may be claimed. */
export const CLAIM_SECONDS = 120
export const MAX_ATTEMPTS = 3

export const startJobSchema = z.object({
  recipeId: z.string().regex(/^[a-z0-9-]{3,60}$/),
  parameters: z.record(z.string(), z.unknown()).optional(),
  /** Static portrait overlay (not lip-synced). Off unless asked for. */
  presenter: z.boolean().optional(),
})

export const progressSchema = z.object({
  runnerId: z.string().regex(/^[\w-]{4,64}$/),
  stage: z.enum(["preparing", "recording", "verifying", "narrating", "producing", "uploading"]),
  step: z.string().max(40).optional(),
  message: z.string().max(200).optional(),
  /** 0–100 */
  percent: z.number().min(0).max(100).optional(),
})

export const completeSchema = z.object({
  runnerId: z.string().regex(/^[\w-]{4,64}$/),
  videoId: z.string().regex(/^[a-f0-9]{8}$/),
  /** Per-step results so the app can show what was demonstrated and what was only clicked through. */
  verified: z.array(z.object({ step: z.string().max(40), verified: z.boolean(), note: z.string().max(200).optional() })).max(30),
  /** Click zoom points in fractions of the recorded picture, validated by parseZooms on the server. */
  zooms: z.array(z.unknown()).max(100).optional(),
  /** Narration cues timed against the final audio, for captions that match what is spoken. */
  cues: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(700) })).max(60).optional(),
  narration: z.object({ voice: z.string().max(60), wpm: z.number().min(40).max(400), synthesized: z.boolean() }).optional(),
})

export const failSchema = z.object({
  runnerId: z.string().regex(/^[\w-]{4,64}$/),
  error: z.string().min(1).max(600),
  stepId: z.string().max(40).optional(),
  /** A browser crash may be worth another try; a step whose expectation failed will fail the same way. */
  retryable: z.boolean().default(false),
})

export interface TutorialJob {
  id: string
  recipeId: string
  recipeVersion: number
  title: string
  parameters: Record<string, string>
  presenter: boolean
  state: JobState
  attempts: number
  stage: string | null
  step: string | null
  message: string | null
  percent: number
  error: string | null
  videoId: string | null
  videoUrl: string | null
  verified: Array<{ step: string; verified: boolean; note?: string }>
  cancelRequested: boolean
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
