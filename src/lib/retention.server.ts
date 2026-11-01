import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm"
import { env } from "cloudflare:workers"
import type { MailEnv } from "@/lib/mail.server"
import { db } from "@/db"
import { uploads, workspaces } from "@/db/schema"
import { APP_NAME } from "@/lib/brand"
import { withMailer } from "@/lib/mail.server"
import { deleteUpload } from "@/lib/recordings.server"
import { isHosted } from "@/lib/workspace.server"

/**
 * Free-plan cleanup, run once a day. A video nobody but its recorder has watched for IDLE_DAYS is
 * warned about 30 days ahead, warned again a week before, then removed (link shows "removed",
 * files kept) and purged 30 days later. Any view, or "Keep" in the library, resets it.
 *
 * Nothing is removed without both warnings having been emailed, so accounts we can't email (no
 * address, or SES not set up) are never cleaned up. Paid workspaces are never touched. A
 * self-hosted install runs this only when RETENTION_DAYS is set, and then for every workspace.
 */

const DAY = 86_400_000
const NOTICE_LEAD_DAYS = 30
const FINAL_LEAD_DAYS = 7
const BATCH = 500

function idleDays(): number | null {
  const configured = Number(Reflect.get(env, "RETENTION_DAYS"))
  if (Number.isFinite(configured) && configured >= 45) return Math.floor(configured)
  return isHosted() ? 90 : null
}

const appUrl = () => String(Reflect.get(env, "APP_URL") || "http://localhost:3000").replace(/\/+$/, "")
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

export async function runRetention(): Promise<Record<string, number>> {
  const idle = idleDays()
  if (!idle) return { skipped: 1 }
  const mail = withMailer<MailEnv>({
    SES_ACCESS_KEY_ID: String(Reflect.get(env, "SES_ACCESS_KEY_ID") ?? "") || undefined,
    SES_SECRET_ACCESS_KEY: String(Reflect.get(env, "SES_SECRET_ACCESS_KEY") ?? "") || undefined,
    SES_REGION: String(Reflect.get(env, "SES_REGION") ?? "") || undefined,
    EMAIL_FROM: String(Reflect.get(env, "EMAIL_FROM") ?? "") || undefined,
  })
  const counts = { cleared: 0, warned: 0, finalWarned: 0, removed: 0, purged: 0 }

  // Workspaces that are now paying keep everything; drop any warnings from their free days.
  const freeOnly = isHosted()
    ? sql`${uploads.workspaceId} in (select id from ${workspaces} where ${workspaces.plan} = 'free')`
    : sql`1 = 1`
  if (isHosted()) {
    const cleared = await db
      .update(uploads)
      .set({ retentionNoticeAt: null, retentionFinalAt: null })
      .where(and(isNotNull(uploads.retentionNoticeAt), isNull(uploads.deletedAt), sql`${uploads.workspaceId} in (select id from ${workspaces} where ${workspaces.plan} <> 'free')`))
    counts.cleared = cleared.meta.changes
  }

  // 1. First warning, IDLE - 30 days in.
  const newlyIdle = await db
    .select({ id: uploads.id, ownerId: uploads.ownerId, title: uploads.title })
    .from(uploads)
    .where(
      and(
        freeOnly,
        eq(uploads.status, "ready"),
        isNull(uploads.deletedAt),
        isNull(uploads.retentionNoticeAt),
        isNotNull(uploads.ownerId),
        lte(sql`coalesce(${uploads.lastViewedAt}, ${uploads.createdAt})`, iso((idle - NOTICE_LEAD_DAYS) * DAY)),
      ),
    )
    .limit(BATCH)
  counts.warned = await warnOwners(mail, newlyIdle, "first", async (ids) => {
    await db.update(uploads).set({ retentionNoticeAt: new Date().toISOString() }).where(inArray(uploads.id, ids))
  })

  // 2. Final warning a week before removal.
  const dueSoon = await db
    .select({ id: uploads.id, ownerId: uploads.ownerId, title: uploads.title })
    .from(uploads)
    .where(
      and(
        freeOnly,
        isNull(uploads.deletedAt),
        isNull(uploads.retentionFinalAt),
        lte(uploads.retentionNoticeAt, iso((NOTICE_LEAD_DAYS - FINAL_LEAD_DAYS) * DAY)),
      ),
    )
    .limit(BATCH)
  counts.finalWarned = await warnOwners(mail, dueSoon, "final", async (ids) => {
    await db.update(uploads).set({ retentionFinalAt: new Date().toISOString() }).where(inArray(uploads.id, ids))
  })

  // 3. Remove: both warnings sent, the first one 30 days ago, no view since.
  const removed = await db
    .update(uploads)
    .set({ deletedAt: new Date().toISOString() })
    .where(
      and(
        freeOnly,
        isNull(uploads.deletedAt),
        isNotNull(uploads.retentionFinalAt),
        lte(uploads.retentionNoticeAt, iso(NOTICE_LEAD_DAYS * DAY)),
        lte(uploads.retentionFinalAt, iso((FINAL_LEAD_DAYS - 1) * DAY)),
      ),
    )
  counts.removed = removed.meta.changes

  // 4. Purge files 30 days after removal.
  const expired = await db
    .select()
    .from(uploads)
    .where(and(isNotNull(uploads.deletedAt), lte(uploads.deletedAt, iso(30 * DAY)), ne(uploads.status, "recording")))
    .limit(50)
  for (const upload of expired) {
    await deleteUpload(upload)
    counts.purged += 1
  }
  return counts
}

interface Flagged {
  id: string
  ownerId: string | null
  title: string | null
}

/** One email per owner per run. Only videos whose owner was actually emailed get marked. */
async function warnOwners(
  mail: MailEnv,
  videos: Array<Flagged>,
  stage: "first" | "final",
  mark: (ids: Array<string>) => Promise<void>,
): Promise<number> {
  if (!mail.EMAIL || !mail.EMAIL_FROM || videos.length === 0) return 0
  const byOwner = new Map<string, Array<Flagged>>()
  for (const video of videos) {
    if (!video.ownerId) continue
    byOwner.set(video.ownerId, [...(byOwner.get(video.ownerId) ?? []), video])
  }
  let marked = 0
  for (const [ownerId, list] of byOwner) {
    const owner = await env.DB.prepare('SELECT email, "isAnonymous" AS anon FROM "user" WHERE id = ?')
      .bind(ownerId)
      .first<{ email: string; anon: number | null }>()
    if (!owner || owner.anon || owner.email.endsWith(".invalid")) continue
    try {
      await mail.EMAIL.send({ to: owner.email, from: mail.EMAIL_FROM, ...warningEmail(list, stage) })
      await mark(list.map((video) => video.id))
      marked += list.length
    } catch (error) {
      console.error(JSON.stringify({ message: "Retention email failed", ownerId, error: (error as Error).message }))
    }
  }
  return marked
}

function warningEmail(videos: Array<Flagged>, stage: "first" | "final") {
  const when = stage === "first" ? "in 30 days" : "in 7 days"
  const count = videos.length === 1 ? "1 video" : `${videos.length} videos`
  const subject = `${count} on ${APP_NAME} will be removed ${when}`
  const lines = videos.slice(0, 20).map((video) => `${video.title || "Untitled video"}: ${appUrl()}/${video.id}`)
  const more = videos.length > 20 ? `\n…and ${videos.length - 20} more in your library.` : ""
  const text = `Nobody has watched ${videos.length === 1 ? "this video" : "these videos"} in a while, so on the free plan ${videos.length === 1 ? "it" : "they"} will be removed ${when}.\n\n${lines.join("\n")}${more}\n\nTo keep a video, open your library and click Keep, or download it. Any paid plan keeps everything:\n${appUrl()}/\n`
  const items = videos
    .slice(0, 20)
    .map((video) => `<li style="margin:4px 0"><a href="${appUrl()}/${video.id}" style="color:#171717">${escapeHtml(video.title || "Untitled video")}</a></li>`)
    .join("")
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:system-ui,sans-serif;color:#171717">
<div style="max-width:480px;margin:40px auto;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:28px">
<h1 style="margin:0 0 8px;font-size:20px">${escapeHtml(subject)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#525252">Nobody has watched ${videos.length === 1 ? "this video" : "these videos"} in a while, so on the free plan ${videos.length === 1 ? "it" : "they"} will be removed ${when}.</p>
<ul style="padding-left:18px;font-size:14px">${items}</ul>${more ? `<p style="font-size:13px;color:#737373">${escapeHtml(more.trim())}</p>` : ""}
<a href="${appUrl()}/" style="display:inline-block;margin-top:12px;background:#171717;color:#fff;border-radius:10px;padding:11px 18px;font-weight:600;font-size:14px;text-decoration:none">Keep or download them</a>
<p style="margin:18px 0 0;font-size:13px;color:#737373">Any paid plan keeps every video for as long as you're subscribed.</p>
</div></body></html>`
  return { subject, text, html }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
