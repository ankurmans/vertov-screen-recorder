import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { viewProgress } from "@/db/schema";
import { json } from "@/lib/api.server";
import { getSessionUser } from "@/lib/auth.server";
import { getUploadById } from "@/lib/uploads.server";

const bodySchema = z.object({
  viewerKey: z.string().min(8).max(64),
  percent: z.number().finite().min(0).max(1),
  seconds: z.number().finite().min(0).max(60 * 60 * 24),
});

/** Watch-progress pings from the share page; the owner's own plays don't count. */
export const Route = createFileRoute("/api/progress/$id")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const upload = await getUploadById(params.id);
        if (!upload) return json({ error: "Not found" }, 404);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid progress" }, 400);
        const user = await getSessionUser(request);
        if (user && user.sub === upload.ownerId) return json({ ok: true, owner: true });
        const cf = (request as Request & { cf?: { country?: string; city?: string } }).cf;
        const viewerKey = user ? `user:${user.sub}` : `anon:${parsed.data.viewerKey}`;
        await db
          .insert(viewProgress)
          .values({
            uploadId: upload.id,
            viewerKey,
            viewerName: user?.name ?? null,
            viewerAvatar: user?.avatar ?? null,
            percent: parsed.data.percent,
            seconds: parsed.data.seconds,
            country: cf?.country ?? null,
            city: cf?.city ?? null,
          })
          .onConflictDoUpdate({
            target: [viewProgress.uploadId, viewProgress.viewerKey],
            set: {
              percent: sql`max(${viewProgress.percent}, excluded.percent)`,
              seconds: sql`max(${viewProgress.seconds}, excluded.seconds)`,
              viewerName: sql`coalesce(excluded.viewer_name, ${viewProgress.viewerName})`,
              viewerAvatar: sql`coalesce(excluded.viewer_avatar, ${viewProgress.viewerAvatar})`,
              updatedAt: sql`datetime('now')`,
            },
          });
        return json({ ok: true });
      },
    },
  },
});
