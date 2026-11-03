import { env } from "cloudflare:workers"
import { withMailer } from "@/lib/mail.server"
import type { MailEnv } from "@/lib/mail.server"
import type { Upload } from "@/db/schema"

export async function notificationPreferences(userId: string) {
  const row = await env.DB.prepare("SELECT comments, first_view FROM notification_preferences WHERE user_id = ?").bind(userId).first<{ comments: number; first_view: number }>()
  const tips = await env.DB.prepare("SELECT opted_out FROM lifecycle_preferences WHERE user_id=?").bind(userId).first<{opted_out:number}>()
  return { comments: row?.comments !== 0, firstView: row?.first_view !== 0, tips: tips?.opted_out !== 1 }
}

export async function saveNotificationPreferences(userId: string, comments: boolean, firstView: boolean, tips?: boolean) {
  if (tips !== undefined) await env.DB.prepare("INSERT INTO lifecycle_preferences(user_id,token,opted_out) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET opted_out=excluded.opted_out").bind(userId,crypto.randomUUID()+crypto.randomUUID(),Number(!tips)).run()
  await env.DB.prepare("INSERT INTO notification_preferences(user_id, comments, first_view) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET comments=excluded.comments, first_view=excluded.first_view").bind(userId, Number(comments), Number(firstView)).run()
}

export async function recordNotification(upload: Upload, kind: "view" | "comment", actor?: string) {
  if (!upload.ownerId || actor === upload.ownerId) return
  try {
    const prefs = await notificationPreferences(upload.ownerId)
    await env.DB.prepare("INSERT OR IGNORE INTO video_notifications(video_id) VALUES (?)").bind(upload.id).run()
    if (kind === "view") {
      const first = await env.DB.prepare("UPDATE video_notifications SET first_view_seen=1, pending_views=? WHERE video_id=? AND first_view_seen=0 RETURNING video_id").bind(Number(prefs.firstView), upload.id).first()
      if (!first || !prefs.firstView) return
    } else {
      if (!prefs.comments) return
      await env.DB.prepare("UPDATE video_notifications SET pending_comments=pending_comments+1 WHERE video_id=?").bind(upload.id).run()
    }
    const claimed = await env.DB.prepare("UPDATE video_notifications SET scheduled=1 WHERE video_id=? AND scheduled=0 RETURNING video_id").bind(upload.id).first()
    if (claimed) {
      try { await env.PROCESS_QUEUE.send({ id: upload.id, kind: "notification" }, { delaySeconds: 900 }) }
      catch { await env.DB.prepare("UPDATE video_notifications SET scheduled=0 WHERE video_id=?").bind(upload.id).run(); console.warn("Notification queue unavailable") }
    }
  } catch { console.warn("Notification could not be recorded") }
}

export async function sendVideoNotification(id: string) {
  try {
    const result = await env.DB.batch([
      env.DB.prepare("SELECT pending_views, pending_comments FROM video_notifications WHERE video_id=? AND scheduled=1").bind(id),
      env.DB.prepare("UPDATE video_notifications SET scheduled=0, pending_views=0, pending_comments=0 WHERE video_id=? AND scheduled=1").bind(id),
    ])
    const counts = result[0].results[0] as { pending_views: number; pending_comments: number } | undefined
    if (!counts) return
    const owner = await env.DB.prepare('SELECT u.email, uploads.owner_id, uploads.title FROM uploads JOIN user u ON u.id=uploads.owner_id WHERE uploads.id=?').bind(id).first<{ email: string; owner_id: string; title: string | null }>()
    if (!owner?.email || owner.email.endsWith(".invalid")) return
    const prefs = await notificationPreferences(owner.owner_id)
    const comments = prefs.comments ? counts.pending_comments : 0
    const viewed = prefs.firstView && counts.pending_views > 0
    if (!comments && !viewed) return
    const value = (name: string) => { const v = Reflect.get(env, name); return typeof v === "string" ? v : undefined }
    const mail = withMailer<MailEnv>({ SES_ACCESS_KEY_ID: value("SES_ACCESS_KEY_ID"), SES_SECRET_ACCESS_KEY: value("SES_SECRET_ACCESS_KEY"), SES_REGION: value("SES_REGION"), EMAIL_FROM: value("EMAIL_FROM") })
    if (!mail.EMAIL || !mail.EMAIL_FROM) { console.warn("SES notification unavailable"); return }
    const text = `${owner.title || "Your video"}: ${[viewed ? "Someone watched for the first time" : "", comments ? `${comments} new comment${comments === 1 ? "" : "s"}` : ""].filter(Boolean).join(". ")}.\nhttp://localhost:3000/${id}\n\nManage notifications in Settings.`
    const html = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!).replace(/\n/g, "<br>")
    await mail.EMAIL.send({ to: owner.email, from: mail.EMAIL_FROM, subject: "New activity on your Vertov video", text, html })
  } catch { console.warn("SES activity notification failed; video activity was saved") }
}
