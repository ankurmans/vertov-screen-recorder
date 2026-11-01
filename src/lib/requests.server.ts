import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { MailEnv } from "@/lib/mail.server"
import type { VideoRequest } from "@/db/schema"
import { db } from "@/db"
import { videoRequests, workspaces } from "@/db/schema"
import { APP_NAME } from "@/lib/brand"
import { withMailer } from "@/lib/mail.server"

export const REQUEST_DAYS = 30

/** A request that still accepts recordings, with the name of the workspace asking; null when missing, revoked or expired. */
export async function liveRequest(id: string) {
  const request = await db.query.videoRequests.findFirst({ where: eq(videoRequests.id, id) })
  if (!request || request.revokedAt || Date.parse(request.expiresAt) <= Date.now()) {
    return null
  }
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, request.workspaceId) })
  return { request, workspaceName: workspace?.name ?? "Someone" }
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)

/** Emails whoever made the request that a video arrived. Does nothing until email is set up or when they signed in as a guest. */
export async function notifyRequester(request: VideoRequest, from: string, uploadId: string, origin: string): Promise<void> {
  const mail = withMailer<MailEnv>({
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
    to: owner.email,
    from: mail.EMAIL_FROM,
    subject: `${from} sent you a video: ${request.title}`,
    text: `${from} recorded a video for "${request.title}".\n\nWatch it: ${url}\n\nIt is in your ${APP_NAME} library.`,
    html: `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:system-ui,sans-serif;color:#171717"><div style="max-width:440px;margin:40px auto;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:28px"><h1 style="margin:0 0 8px;font-size:20px">${escapeHtml(from)} sent you a video</h1><p style="margin:0 0 20px;color:#525252">For your request "${title}". It is in your ${APP_NAME} library.</p><a href="${url}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">Watch it</a></div></body></html>`,
  })
}
