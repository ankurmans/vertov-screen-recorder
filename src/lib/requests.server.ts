import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { MailEnv } from "@/lib/mail.server"
import type { VideoRequest } from "@/db/schema"
import { db } from "@/db"
import { accessFor } from "@/lib/access.server"
import { uploads, videoRequests, workspaces } from "@/db/schema"
import { APP_NAME } from "@/lib/brand"
import { withMailer } from "@/lib/mail.server"
import { emailButton } from "@/lib/email-layout"
import { KEPT_OPEN_LIMIT, isKeptOpen, replyIdRange, replyUploadId } from "@/lib/request-link"
import { roleIn } from "@/lib/workspace.server"

export const REQUEST_DAYS = 30

/** Recorders see this title, and "Re:" reads the same in every language. */
export const replyTitle = (videoTitle: string | null) => `Re: ${videoTitle?.trim() || "your video"}`.slice(0, 120)

/**
 * A request that still accepts recordings from this visitor, with the name of the workspace asking; null when missing,
 * revoked or expired, or when it replies to a video the visitor can't watch.
 */
export async function liveRequest(id: string, visitor: Request) {
  const request = await db.query.videoRequests.findFirst({ where: eq(videoRequests.id, id) })
  if (!request || request.revokedAt || Date.parse(request.expiresAt) <= Date.now()) {
    return null
  }
  // A reply link follows its video: deleting, expiring or locking the video closes it to those who can no longer watch.
  const about = replyUploadId(request.id)
  let title = request.title
  if (about) {
    const video = await db.query.uploads.findFirst({ where: eq(uploads.id, about) })
    if (!video || video.deletedAt || (await accessFor(video, visitor)) !== "open") return null
    title = replyTitle(video.title)
  }
  // Uploads sent through a link become the creator's, so it works only while they are still in the workspace.
  if (!(await roleIn(request.workspaceId, request.createdBy))) return null
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, request.workspaceId) })
  return { request: { ...request, title }, workspaceName: workspace?.name ?? "Someone" }
}

/** Whether a kept-open link has taken all the videos it can. Ordinary links end by date, not by count. */
export async function requestIsFull(request: VideoRequest): Promise<boolean> {
  if (!isKeptOpen(request.expiresAt)) return false
  const row = await env.DB.prepare("SELECT count(*) AS n FROM uploads WHERE request_id = ?").bind(request.id).first<{ n: number }>()
  return (row?.n ?? 0) >= KEPT_OPEN_LIMIT
}

const OPEN_REPLY = `SELECT r.id FROM video_requests AS r WHERE r.id >= ? AND r.id < ? AND r.revoked_at IS NULL
  AND (SELECT count(*) FROM uploads AS sent WHERE sent.request_id = r.id) < ? LIMIT 1`
const openReplyArgs = (uploadId: string) => [...replyIdRange(uploadId), KEPT_OPEN_LIMIT] as const

/** The link a video's viewers can answer through, or null when its sender has not asked for a reply (or it is full). */
export async function openReplyRequest(uploadId: string): Promise<string | null> {
  const row = await env.DB.prepare(OPEN_REPLY).bind(...openReplyArgs(uploadId)).first<{ id: string }>()
  return row?.id ?? null
}

/** The share page's like count and open reply link in one statement. Neither is worth failing the page over. */
export async function likesAndReply(uploadId: string): Promise<{ likeCount: number; replyRequestId: string | null }> {
  try {
    const row = await env.DB.prepare(`SELECT (SELECT count(*) FROM likes WHERE upload_id = ?) AS likes, (${OPEN_REPLY}) AS reply`)
      .bind(uploadId, ...openReplyArgs(uploadId))
      .first<{ likes: number; reply: string | null }>()
    return { likeCount: row?.likes ?? 0, replyRequestId: row?.reply ?? null }
  } catch {
    return { likeCount: 0, replyRequestId: null }
  }
}

export async function closeReplyRequests(uploadId: string): Promise<void> {
  await env.DB.prepare("UPDATE video_requests SET revoked_at = ? WHERE id >= ? AND id < ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), ...replyIdRange(uploadId))
    .run()
}

/** Closes the open request links a person made in a workspace they are leaving or being removed from. */
export async function revokeRequestsBy(workspaceId: string, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE video_requests SET revoked_at = ? WHERE workspace_id = ? AND created_by = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), workspaceId, userId)
    .run()
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)

/** Emails whoever made the request that a video arrived. Does nothing until email is set up or when they signed in as a guest. */
export async function notifyRequester(request: VideoRequest, from: string, uploadId: string, origin: string): Promise<void> {
  const mail = withMailer<MailEnv>({
    DB: env.DB,
    SES_ACCESS_KEY_ID: String(Reflect.get(env, "SES_ACCESS_KEY_ID") ?? "") || undefined,
    SES_SECRET_ACCESS_KEY: String(Reflect.get(env, "SES_SECRET_ACCESS_KEY") ?? "") || undefined,
    SES_REGION: String(Reflect.get(env, "SES_REGION") ?? "") || undefined,
    EMAIL_FROM: String(Reflect.get(env, "EMAIL_FROM") ?? "") || undefined,
  })
  if (!mail.EMAIL || !mail.EMAIL_FROM) return
  const owner = await env.DB.prepare('SELECT email, "isAnonymous" AS anon FROM "user" WHERE id = ?')
    .bind(request.createdBy)
    .first<{ email: string; anon: number | null }>()
  if (!owner || owner.anon || owner.email.endsWith(".invalid")) return
  const url = `${origin}/${uploadId}`
  const title = escapeHtml(request.title)
  await mail.EMAIL.send({
    audit: { stream: "transactional", template: "video-request-completed" },
    to: owner.email,
    from: mail.EMAIL_FROM,
    subject: "New video reply 🎥",
    text: `${from} recorded a video for "${request.title}".\n\nWatch it: ${url}\n\nIt is in your ${APP_NAME} library.`,
    html: `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;letter-spacing:-.7px">${escapeHtml(from)} sent you a video</h1><p style="margin:0 0 20px">For your request "${title}". It is in your ${APP_NAME} library.</p>${emailButton(url, "Watch the video")}`,
  })
}
