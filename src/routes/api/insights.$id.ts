import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { viewProgress, viewerEmails } from "@/db/schema";
import { json } from "@/lib/api.server";
import { csv } from "@/lib/csv";
import { ownedUpload, userApi } from "@/lib/recordings.server";

/** Who watched and how far, for the owner only. */
export const Route = createFileRoute("/api/insights/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Not found" }, 404);
          const viewers = await db
            .select()
            .from(viewProgress)
            .where(eq(viewProgress.uploadId, upload.id))
            .orderBy(desc(viewProgress.updatedAt))
            .limit(500);
          const emails = await db
            .select({ email: viewerEmails.email, at: viewerEmails.createdAt })
            .from(viewerEmails)
            .where(eq(viewerEmails.uploadId, upload.id))
            .orderBy(desc(viewerEmails.createdAt))
            .limit(2000);
          if (new URL(request.url).searchParams.get("format") === "csv") {
            const rows: Array<Array<string | number | null>> = [
              ["type", "name or email", "percent watched", "seconds", "place", "time"],
              ...viewers.map((v) => ["viewer", v.viewerName, Math.round(v.percent * 100), Math.round(v.seconds), [v.city, v.country].filter(Boolean).join(", ") || null, v.updatedAt]),
              ...emails.map((e) => ["email", e.email, null, null, null, e.at]),
            ];
            return new Response(csv(rows), {
              headers: {
                "content-type": "text/csv; charset=utf-8",
                "content-disposition": `attachment; filename="insights-${upload.id}.csv"`,
              },
            });
          }
          const average =
            viewers.length > 0
              ? viewers.reduce((sum, viewer) => sum + viewer.percent, 0) / viewers.length
              : null;
          return json({
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
            averageCompletion: average,
            emails,
          });
        }),
    },
  },
});
