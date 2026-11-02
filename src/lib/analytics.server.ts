import type { SessionUser } from "@/lib/auth.server"
import { json } from "@/lib/api.server"
import { ownedUpload } from "@/lib/recordings.server"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { uploads, viewEvents, viewProgress, viewerEmails } from "@/db/schema"
import { csv } from "@/lib/csv"

function workspaceVideos(workspaceId: string) {
  return and(eq(uploads.workspaceId, workspaceId), eq(uploads.mediaType, "video"), isNull(uploads.deletedAt))
}

export async function workspaceInsights(workspaceId: string) {
  const mine = workspaceVideos(workspaceId)
  const [totals, progress, top, perDay] = await Promise.all([
    db
      .select({
        totalVideos: sql<number>`count(*)`,
        totalViews: sql<number>`coalesce(sum(${uploads.views}), 0)`,
        ctaClicks: sql<number>`coalesce(sum(${uploads.ctaClicks}), 0)`,
      })
      .from(uploads)
      .where(mine),
    db
      .select({ average: sql<number | null>`avg(${viewProgress.percent})`, count: sql<number>`count(*)` })
      .from(viewProgress)
      .innerJoin(uploads, eq(uploads.id, viewProgress.uploadId))
      .where(mine),
    db
      .select({ id: uploads.id, title: uploads.title, views: uploads.views, ctaClicks: uploads.ctaClicks })
      .from(uploads)
      .where(mine)
      .orderBy(desc(uploads.views), desc(uploads.createdAt), uploads.id)
      .limit(10),
    db
      .select({ day: sql<string>`date(${viewEvents.createdAt})`, views: sql<number>`count(*)` })
      .from(viewEvents)
      .innerJoin(uploads, eq(uploads.id, viewEvents.uploadId))
      .where(
        and(
          mine,
          sql`${viewEvents.createdAt} >= date('now', '-29 days') AND ${viewEvents.createdAt} < date('now', '+1 day')`,
        ),
      )
      .groupBy(sql`date(${viewEvents.createdAt})`)
      .orderBy(sql`date(${viewEvents.createdAt})`),
  ])
  const counts = new Map(perDay.map((row) => [row.day, row.views]))
  const today = Date.now()
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(today - (29 - index) * 86_400_000).toISOString().slice(0, 10)
    return { day, views: counts.get(day) ?? 0 }
  })
  return { ...totals[0], averageCompletion: progress[0].average, progressSamples: progress[0].count, top, days }
}

export async function workspaceInsightsCsv(workspaceId: string) {
  const rows = await db
    .select({
      id: uploads.id,
      title: uploads.title,
      createdAt: uploads.createdAt,
      duration: uploads.duration,
      views: uploads.views,
      ctaClicks: uploads.ctaClicks,
      average: sql<number | null>`avg(${viewProgress.percent})`,
    })
    .from(uploads)
    .leftJoin(viewProgress, eq(uploads.id, viewProgress.uploadId))
    .where(workspaceVideos(workspaceId))
    .groupBy(uploads.id)
    .orderBy(desc(uploads.views), uploads.id)
  return new Response(
    csv([
      ["video id", "title", "recorded UTC", "duration seconds", "views", "average progress percent", "CTA clicks"],
      ...rows.map((row) => [
        row.id,
        row.title,
        row.createdAt,
        row.duration,
        row.views,
        row.average == null ? null : Math.round(row.average * 100),
        row.ctaClicks,
      ]),
    ]),
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="workspace-insights.csv"',
        "cache-control": "private, no-store",
      },
    },
  )
}

export async function videoInsightsResponse(request: Request, id: string, user: SessionUser) {
  const upload = await ownedUpload(id, user)
  if (!upload) return json({ error: "Not found" }, 404)
  const viewers = await db
    .select()
    .from(viewProgress)
    .where(eq(viewProgress.uploadId, upload.id))
    .orderBy(desc(viewProgress.updatedAt))
    .limit(500)
  const emails = await db
    .select({ email: viewerEmails.email, at: viewerEmails.createdAt })
    .from(viewerEmails)
    .where(eq(viewerEmails.uploadId, upload.id))
    .orderBy(desc(viewerEmails.createdAt))
    .limit(2000)
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const rows: Array<Array<string | number | null>> = [
      ["type", "name or email", "furthest progress percent", "furthest timestamp seconds", "place", "time"],
      ...viewers.map((v) => [
        "viewer",
        v.viewerName,
        Math.round(v.percent * 100),
        Math.round(v.seconds),
        [v.city, v.country].filter(Boolean).join(", ") || null,
        v.updatedAt,
      ]),
      ...emails.map((e) => ["email", e.email, null, null, null, e.at]),
    ]
    return new Response(csv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="insights-${upload.id}.csv"`,
      },
    })
  }
  const [progress] = await db
    .select({ average: sql<number | null>`avg(${viewProgress.percent})`, count: sql<number>`count(*)` })
    .from(viewProgress)
    .where(eq(viewProgress.uploadId, upload.id))
  return json(
    {
      views: upload.views,
      ctaClicks: upload.ctaClicks,
      ctaLabel: upload.ctaLabel,
      viewers: viewers.map((viewer) => ({
        name: viewer.viewerName,
        avatar: viewer.viewerAvatar,
        percent: viewer.percent,
        seconds: viewer.seconds,
        place: [viewer.city, viewer.country].filter(Boolean).join(", ") || null,
        at: viewer.updatedAt,
      })),
      averageCompletion: progress.average,
      viewerCount: progress.count,
      emails,
    },
    { headers: { "cache-control": "private, no-store" } },
  )
}
