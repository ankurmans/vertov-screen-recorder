import { parseAiDocs } from "@/lib/ai-docs.server"
import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import { emitWebhook } from "@/lib/webhooks"
import type { Upload, Workspace } from "@/db/schema"
import type { SessionUser } from "@/lib/auth.server"
import type { Role } from "@/lib/plans"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import { streamToR2 } from "@/lib/export.server"
import { canManage } from "@/lib/plans"
import { newShareId } from "@/lib/recordings.server"
import { getTranscript, getUploadById } from "@/lib/uploads.server"

/**
 * What agents (API keys, MCP clients, scripts) do with videos: hand over a finished file and get a
 * share link back, and read a video as text: transcript, summary, chapters and a ready-made prompt.
 * Agents don't need computer use to record: a browser agent already has video from Playwright's
 * recordVideo or a CDP screencast, and a desktop agent from ffmpeg; this turns that file into a link.
 */

// Whisper takes the file inline, so only files up to this size get a transcript straight away.
const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024

export function videoContainer(contentType: string | null): { type: "video/mp4" | "video/webm"; ext: "mp4" | "webm" } | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase()
  if (type === "video/webm") return { type, ext: "webm" }
  if (type === "video/mp4" || type === "video/quicktime" || type === "video/x-m4v") return { type: "video/mp4", ext: "mp4" }
  return null
}

/** Stores a finished video sent in the request body; it's playable as soon as this returns. */
export async function createVideoFromBody(
  user: SessionUser,
  workspace: Workspace,
  body: ReadableStream<Uint8Array>,
  container: { type: string; ext: string },
  meta: { title: string | null; duration: number | null; spaceId: string | null },
): Promise<Upload> {
  const id = newShareId()
  const key = `uploads/${id}/recording.${container.ext}`
  const size = await streamToR2(key, body, container.type)
  const transcribe = size <= MAX_TRANSCRIBE_BYTES
  await db.insert(uploads).values({
    id,
    filename: `recording.${container.ext}`,
    contentType: container.type,
    size,
    r2Key: key,
    mediaType: "video",
    ownerId: user.sub,
    workspaceId: workspace.id,
    spaceId: meta.spaceId,
    visibility: workspace.defaultVisibility,
    downloadsEnabled: workspace.downloadsDefault,
    status: "ready",
    duration: meta.duration,
    title: meta.title,
    captureSurface: "agent",
    audioKey: transcribe ? key : null,
    aiStatus: transcribe ? "pending" : null,
  })
  if (transcribe) await env.PROCESS_QUEUE.send({ id })
  const upload = await getUploadById(id)
  if (!upload) throw new Error("upload vanished")
  emitWebhook(workspace.id, "video.ready", { id, url: `/${id}`, title: meta.title, duration: meta.duration })
  return upload
}

/** Creates the link now and copies the file from a public URL in the background. */
export async function createVideoFromUrl(
  user: SessionUser,
  workspace: Workspace,
  url: string,
  meta: { title: string | null; spaceId: string | null; sourceUrl?: string | null },
): Promise<Upload> {
  const id = newShareId()
  await db.insert(uploads).values({
    id,
    filename: "recording.mp4",
    contentType: "video/mp4",
    size: 0,
    r2Key: `uploads/${id}/recording.mp4`,
    mediaType: "video",
    ownerId: user.sub,
    workspaceId: workspace.id,
    spaceId: meta.spaceId,
    visibility: workspace.defaultVisibility,
    downloadsEnabled: workspace.downloadsDefault,
    status: "importing",
    title: meta.title,
    captureSurface: meta.sourceUrl ? "import" : "agent",
    sourceUrl: meta.sourceUrl ?? url,
  })
  await env.PROCESS_QUEUE.send({ id, kind: "fetch", url })
  const upload = await getUploadById(id)
  if (!upload) throw new Error("upload vanished")
  return upload
}

/** Queue job for createVideoFromUrl. */
export async function processFetch(id: string, url: string): Promise<void> {
  const upload = await getUploadById(id)
  if (!upload || upload.status !== "importing") return
  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; Vertov fetcher)" } })
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`)
    const container = videoContainer(response.headers.get("content-type")) ?? (/\.webm(\?|$)/i.test(url) ? { type: "video/webm" as const, ext: "webm" as const } : { type: "video/mp4" as const, ext: "mp4" as const })
    const key = `uploads/${id}/recording.${container.ext}`
    const size = await streamToR2(key, response.body, container.type)
    const transcribe = size <= MAX_TRANSCRIBE_BYTES
    await db
      .update(uploads)
      .set({
        r2Key: key,
        filename: `recording.${container.ext}`,
        contentType: container.type,
        size,
        status: "ready",
        audioKey: transcribe ? key : null,
        aiStatus: transcribe ? "pending" : null,
      })
      .where(eq(uploads.id, id))
    if (transcribe) await env.PROCESS_QUEUE.send({ id })
  } catch (error) {
    console.error(JSON.stringify({ message: "Fetch failed", id, error: error instanceof Error ? error.message : String(error) }))
    await db.update(uploads).set({ status: "failed" }).where(eq(uploads.id, id))
  }
}

/** Whether a workspace member can read this video: their own, anything in a space, or anything if they run the workspace. */
export function memberCanSee(upload: Upload, user: SessionUser, workspaceId: string, role: Role): boolean {
  if (upload.workspaceId !== workspaceId || upload.deletedAt) return false
  return upload.ownerId === user.sub || Boolean(upload.spaceId) || canManage(role)
}

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = String(whole % 60).padStart(2, "0")
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`
}

function parseChapters(raw: string | null): Array<{ title: string; start: number }> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(parsed) ? (parsed as Array<{ title: string; start: number }>) : []
  } catch {
    return []
  }
}

/** A video as an agent reads it. */
export async function videoForAgent(upload: Upload, origin: string, withTranscript: boolean) {
  const transcript = withTranscript ? await getTranscript(upload) : null
  return {
    id: upload.id,
    url: `${origin}/${upload.id}`,
    embedUrl: `${origin}/embed/${upload.id}`,
    title: upload.title,
    status: upload.status,
    aiStatus: upload.aiStatus,
    duration: upload.duration,
    language: upload.language,
    summary: upload.summary,
    chapters: parseChapters(upload.chapters),
    visibility: upload.visibility,
    createdAt: upload.createdAt,
    ...(withTranscript
      ? { aiDocs: parseAiDocs(upload.aiDocs), transcript: transcript ? transcript.cues.map((cue) => `[${clock(cue.start)}] ${cue.text}`).join("\n") : null }
      : {}),
  }
}

export interface ScreenEvent {
  /** Seconds into the video. */
  t: number
  type: "page" | "click" | "input"
  url?: string
  title?: string
  /** Visible text or label of what was clicked. */
  text?: string
  /** Tag plus id/class/role hints, enough for an agent to find the element. */
  selector?: string
}

/** Clicks and page visits the Chrome extension recorded alongside the video. */
export async function screenEvents(upload: Upload): Promise<Array<ScreenEvent>> {
  const object = await env.BUCKET.get(`uploads/${upload.id}/events`)
  if (!object) return []
  try {
    const parsed: unknown = await object.json()
    if (!Array.isArray(parsed)) return []
    return (parsed as Array<ScreenEvent>)
      .filter((event) => typeof event.t === "number" && typeof event.type === "string")
      .sort((a, b) => a.t - b.t)
  } catch {
    return []
  }
}

function describeEvent(event: ScreenEvent): string {
  const at = `[${clock(event.t)}]`
  const what = (value: string | undefined) => (value ? `“${value.slice(0, 80)}”` : "")
  if (event.type === "page") return `${at} Opened ${event.url ?? "a page"}${event.title ? ` (${event.title.slice(0, 80)})` : ""}`
  if (event.type === "input") return `${at} Typed in ${what(event.text) || event.selector || "a field"}`
  return `${at} Clicked ${what(event.text)}${event.selector ? ` \`${event.selector.slice(0, 120)}\`` : ""}${event.url ? ` on ${event.url}` : ""}`
}

/**
 * The whole video as one Markdown prompt for an agent: what it is, where it is, what was said and
 * when. Pasting this into a coding agent is the browser-only version of "record for agents".
 */
export async function agentPrompt(upload: Upload, origin: string): Promise<string> {
  const video = await videoForAgent(upload, origin, true)
  const lines = [
    `# ${video.title || "Screen recording"}`,
    "",
    `Video: ${video.url}${video.duration ? ` (${clock(video.duration)})` : ""}`,
    "",
    "Below is a screen recording someone made to show you what they want. Treat the transcript as their instructions, in order. Timestamps point to the moment in the video; open the link at ?t=<seconds> to see that spot.",
  ]
  if (video.summary) lines.push("", "## Summary", "", video.summary)
  if (video.chapters.length) {
    lines.push("", "## Chapters", "", ...video.chapters.map((chapter) => `- [${clock(chapter.start)}] ${chapter.title}`))
  }
  const events = await screenEvents(upload)
  if (events.length) {
    lines.push(
      "",
      "## What happened on screen",
      "",
      "Recorded by the browser extension: pages opened and elements clicked, with the moment in the video.",
      "",
      ...events.slice(0, 300).map(describeEvent),
    )
  }
  lines.push("", "## Transcript", "", video.transcript ?? (video.aiStatus === "pending" ? "(Still transcribing; try again in a minute.)" : "(No speech in this recording.)"))
  return lines.join("\n")
}
