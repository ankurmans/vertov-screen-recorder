import type { TutorialJob } from "@/lib/tutorials/jobs"

export interface RecipeSummary {
  id: string
  version: number
  title: string
  summary: string
  preconditions: Array<string>
  parameters: Array<{ name: string; label: string; description?: string; default: string; maxLength: number }>
  steps: Array<{ id: string; goal: string; narration: string; seconds: number }>
  words: number
  estimatedSeconds: number
}

export interface JobsResponse {
  runnerOnline: boolean
  jobs: Array<TutorialJob>
}

export const formatSeconds = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds))
  return whole >= 60 ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}` : `${whole}s`
}
