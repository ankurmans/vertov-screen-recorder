/** Who gets which file of an edited video. The renders themselves are in viewer-copy.server.ts. */
import { env } from "cloudflare:workers"
import type { Upload } from "@/db/schema"
import { getSessionUser } from "@/lib/auth.server"
import { canManage } from "@/lib/plans"
import { viewerChoice } from "@/lib/viewer-copy"
import type { Playback, Track } from "@/lib/viewer-copy"
import { roleIn } from "@/lib/workspace.server"

/**
 * VIEWER_COPIES: "on" serves viewers the copy; "build" makes copies but still serves originals (to render existing edits
 * before switching on); anything else does neither.
 */
export function viewerCopiesMode(): "off" | "build" | "on" {
  const mode = Reflect.get(env, "VIEWER_COPIES") as string | undefined // the generated type names only today's value
  return mode === "on" || mode === "build" ? mode : "off"
}

/** What viewers of this video get now. */
export function viewerPlayback(upload: Upload): ReturnType<typeof viewerChoice> {
  return viewerCopiesMode() === "on" ? viewerChoice(upload) : { kind: "original" }
}

/** What the page needs to point its player at the right files. */
export function playbackFor(upload: Upload): Playback {
  const choice = viewerPlayback(upload)
  return {
    enabled: viewerCopiesMode() === "on",
    state: choice.kind,
    token: choice.kind === "copy" ? choice.copy.token : null,
    failed: choice.kind === "held" && upload.viewerStatus === "failed",
  }
}

/** The recorder, or an owner or admin of the video's workspace: the people who edit it and so see all of it. */
export async function managesVideo(upload: Upload, request: Request, readUser = () => getSessionUser(request)): Promise<boolean> {
  const user = await readUser()
  if (!user) return false
  return upload.ownerId === user.sub || canManage(await roleIn(upload.workspaceId, user.sub))
}

/** Whether pictures and data taken from the original must be kept from this requester: footage is removed and they don't edit it. */
export async function limitedViewer(upload: Upload, request: Request): Promise<boolean> {
  return viewerPlayback(upload).kind !== "original" && !(await managesVideo(upload, request))
}

/**
 * Which file a media request gets. null: the original, as ever. "editor": the original of an edited video, for the people
 * who edit it (so it must not be cached for others). "held": nothing yet. Otherwise the blanked copy.
 */
export async function copyForRequest(
  upload: Upload, track: Track, request: Request, readUser?: () => ReturnType<typeof getSessionUser>,
): Promise<{ key: string; contentType: string; token: string } | "editor" | "held" | null> {
  const choice = viewerPlayback(upload)
  if (choice.kind === "original") return null
  // The editor asks for the original; anyone else asking gets what viewers get.
  if (new URL(request.url).searchParams.has("original") && (await managesVideo(upload, request, readUser))) return "editor"
  const file = choice.kind === "copy" ? choice.copy[track] : undefined
  if (choice.kind === "held" || !file) return "held"
  return { key: file.key, contentType: "video/mp4", token: choice.copy.token }
}
