import { createFileRoute } from "@tanstack/react-router"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { uploads, viewEvents, viewProgress } from "@/db/schema"
import { json } from "@/lib/api.server"
import { csv } from "@/lib/csv"
import { workspaceApi } from "@/lib/workspace-api.server"

/** Workspace-wide viewing numbers for owners and admins; ?format=csv downloads per-video stats. */
export const Route = createFileRoute("/api/workspace/insights")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(
          request,
          async (_user, { workspace }) => {
            const mine = and(eq(uploads.workspaceId, workspace.id), eq(uploads.mediaType, "video"), isNull(uploads.deletedAt))
            const videos = await db
              .select({ id: uploads.id, title: uploads.title, views: uploads.views, createdAt: uploads.createdAt, duration: uploads.duration })
              .from(uploads)
              .where(mine)
              .orderBy(desc(uploads.views))
              .limit(5000)
            const completion = await db
              .select({ uploadId: viewProgress.uploadId, average: sql<number>`avg(${viewProgress.percent})` })
              .from(viewProgress)
              .innerJoin(uploads, eq(uploads.id, viewProgress.uploadId))
              .where(mine)
              .groupBy(viewProgress.uploadId)
            const averages = new Map(completion.map((row) => [row.uploadId, row.average]))

            if (new URL(request.url).searchParams.get("format") === "csv") {
              const rows: Array<Array<string | number | null>> = [
                ["video id", "title", "recorded", "duration seconds", "views", "average completion percent"],
                ...videos.map((video) => {
                  const average = averages.get(video.id)
                  return [video.id, video.title, video.createdAt, video.duration == null ? null : Math.round(video.duration), video.views, average == null ? null : Math.round(average * 100)]
                }),
              ]
              return new Response(csv(rows), {
                headers: {
                  "content-type": "text/csv; charset=utf-8",
                  "content-disposition": 'attachment; filename="workspace-insights.csv"',
                },
              })
            }

            const perDay = await db
              .select({ day: sql<string>`date(${viewEvents.createdAt})`, views: sql<number>`count(*)` })
              .from(viewEvents)
              .innerJoin(uploads, eq(uploads.id, viewEvents.uploadId))
              .where(and(mine, sql`${viewEvents.createdAt} >= datetime('now', '-30 days')`))
              .groupBy(sql`date(${viewEvents.createdAt})`)
              .orderBy(sql`date(${viewEvents.createdAt})`)
            const counts = new Map(perDay.map((row) => [row.day, row.views]))
            const days = Array.from({ length: 30 }, (_, index) => {
              const day = new Date(Date.now() - (29 - index) * 86_400_000).toISOString().slice(0, 10)
              return { day, views: counts.get(day) ?? 0 }
            })
            const rated = [...averages.values()]
            return json({
              totalVideos: videos.length,
              totalViews: videos.reduce((sum, video) => sum + video.views, 0),
              averageCompletion: rated.length > 0 ? rated.reduce((sum, value) => sum + value, 0) / rated.length : null,
              top: videos.slice(0, 10).map((video) => ({ id: video.id, title: video.title, views: video.views })),
              days,
            })
          },
          { manage: true },
        ),
    },
  },
})
