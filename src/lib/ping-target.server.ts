import { env } from "cloudflare:workers"
import type { Upload } from "@/db/schema"
import { isUnclaimedGuest } from "@/lib/access.server"
import { HOSTED_EDITION } from "@/lib/edition"
import { overLimitFor } from "@/lib/edge-limit.server"

/**
 * The part of a video a viewer ping needs, for videos that anyone with the link may watch. A viral video sends thousands
 * of pings, each of which used to read the upload and its owner's guest status from D1 only to learn the same answer. An
 * anonymous ping now looks the answer up in the Cloudflare cache (per location, a minute) and touches no database.
 * Anything that needs the viewer (a password, members only, an expiry, a required email, a guest owner, a removed video)
 * is never cached and takes the full access check. The answer can be a minute stale: a video locked or removed in that
 * minute may still count a few views, which the queue consumer drops when the upload is gone.
 */
export interface PingTarget {
  id: string
  ownerId: string | null
  workspaceId: string | null
  title: string | null
  mediaType: string
  ready: boolean
  /** The workspace is on the Free plan (hosted only), which gets the lower ping ceilings. */
  free: boolean
}

const TTL_SECONDS = 60
const edgeCache = () => (caches as unknown as { default: Cache }).default
const cacheKey = (id: string) => new Request(`https://ping.vertov.internal/${id}`)

/** True when the request carries no sign-in at all, so who is watching cannot matter to the answer. */
export function isAnonymous(request: Request): boolean {
  if (request.headers.get("authorization")) return false
  return !/session_token|session_data/.test(request.headers.get("cookie") ?? "")
}

export async function cachedTarget(id: string): Promise<PingTarget | null> {
  try {
    const hit = await edgeCache().match(cacheKey(id))
    return hit ? ((await hit.json()) as PingTarget) : null
  } catch {
    return null
  }
}

async function rememberTarget(target: PingTarget): Promise<void> {
  try {
    await edgeCache().put(cacheKey(target.id), new Response(JSON.stringify(target), { headers: { "cache-control": `max-age=${TTL_SECONDS}` } }))
  } catch {
    // Not cached: the next ping takes the full check.
  }
}

/** Whether this video's workspace is on the Free plan. Self-hosted installs have no plans, so never. */
export async function isFreeWorkspace(workspaceId: string | null): Promise<boolean> {
  if (!HOSTED_EDITION || !workspaceId) return false
  const row = await env.DB.prepare("SELECT plan FROM workspaces WHERE id = ?").bind(workspaceId).first<{ plan: string }>()
  return !row || row.plan === "free"
}

export async function targetFor(upload: Upload): Promise<PingTarget> {
  return {
    id: upload.id,
    ownerId: upload.ownerId,
    workspaceId: upload.workspaceId,
    title: upload.title,
    mediaType: upload.mediaType,
    ready: upload.status === "ready",
    free: await isFreeWorkspace(upload.workspaceId),
  }
}

/** Caches the video's ping target when anyone with the link may watch it, and returns whether it did. */
export async function cacheIfPublic(upload: Upload, target: PingTarget): Promise<boolean> {
  if (upload.expiresAt || upload.passwordHash || upload.visibility === "workspace" || upload.deletedAt || upload.requireEmail) return false
  if (await isUnclaimedGuest(upload.ownerId)) return false
  await rememberTarget(target)
  return true
}

type Limiters = { VIEW_FREE_LIMITER?: RateLimit; VIEW_PAID_LIMITER?: RateLimit; PROGRESS_LIMITER?: RateLimit }
const limiters = () => env as unknown as Limiters

/** True when this video has taken more view pings than its plan allows this minute at this location. */
export const viewsOverLimit = (target: Pick<PingTarget, "id" | "free">) =>
  overLimitFor(target.free ? limiters().VIEW_FREE_LIMITER : limiters().VIEW_PAID_LIMITER, target.id)

/** True when this viewer has sent too many progress pings for this video this minute. */
export const progressOverLimit = (id: string, viewerKey: string) => overLimitFor(limiters().PROGRESS_LIMITER, `${id}:${viewerKey}`)
