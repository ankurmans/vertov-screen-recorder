import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { viewProgress } from "@/db/schema";
import { json } from "@/lib/api.server";
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
          const average =
            viewers.length > 0
              ? viewers.reduce((sum, viewer) => sum + viewer.percent, 0) / viewers.length
              : null;
          return json({
            views: upload.views,
            viewers: viewers.map((viewer) => ({
              name: viewer.viewerName,
              avatar: viewer.viewerAvatar,
              percent: viewer.percent,
              seconds: viewer.seconds,
              place: [viewer.city, viewer.country].filter(Boolean).join(", ") || null,
              at: viewer.updatedAt,
            })),
            averageCompletion: average,
          });
        }),
    },
  },
});
