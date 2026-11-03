import { z } from "zod"
import { apiKey, appUrl } from "./config"
import type { completeSchema, failSchema, progressSchema } from "../../src/lib/tutorials/jobs"
import type { Recipe } from "../../src/lib/tutorials/recipe"
import type { TutorialJob } from "../../src/lib/tutorials/jobs"

type Body<T extends z.ZodType> = z.input<T>

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** One authenticated request (streamed bodies need duplex: "half") to the Vertov API. Errors carry the server's message, never the key. */
export async function apiFetch(path: string, init: RequestInit & { query?: Record<string, string | number | undefined>; duplex?: "half" } = {}): Promise<Response> {
  const url = new URL(path, appUrl())
  for (const [name, value] of Object.entries(init.query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value))
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${apiKey()}`)
  const { query: _query, ...rest } = init
  return fetch(url, { ...rest, headers })
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
  }
  return (await response.json()) as T
}

const post = (path: string, body: unknown) =>
  apiFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

export interface Claim {
  job: TutorialJob
  recipe: Recipe
}

/** Asks for the next job; null when nothing is waiting. */
export async function claim(runnerId: string): Promise<Claim | null> {
  const response = await post("/api/v1/tutorials/claim", { runnerId })
  if (response.status === 204) return null
  return json<Claim | { job: null }>(response).then((body) => (body.job ? (body as Claim) : null))
}

export const progress = (jobId: string, body: Body<typeof progressSchema>) => post(`/api/v1/tutorials/jobs/${jobId}/progress`, body).then((r) => json<{ cancel: boolean }>(r))
export const complete = (jobId: string, body: Body<typeof completeSchema>) => post(`/api/v1/tutorials/jobs/${jobId}/complete`, body).then((r) => json<TutorialJob>(r))
export const fail = (jobId: string, body: Body<typeof failSchema>) => post(`/api/v1/tutorials/jobs/${jobId}/fail`, body).then((r) => json<unknown>(r))
