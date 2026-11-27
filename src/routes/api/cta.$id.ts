import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { denyUnlessViewable } from "@/lib/access.server";
import { json, optionsResponse } from "@/lib/api.server";
import { ensureSchema, getUploadById } from "@/lib/uploads.server";

/** Counts a click on a video's call-to-action button. Only videos that have a button count, and only from viewers who may watch. */
export const Route = createFileRoute("/api/cta/$id")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        await ensureSchema();
        const denied = await denyUnlessViewable(await getUploadById(params.id), request);
        if (denied) return denied;
        const result = await db
          .update(uploads)
          .set({ ctaClicks: sql`${uploads.ctaClicks} + 1` })
          .where(and(eq(uploads.id, params.id), isNotNull(uploads.ctaUrl)));
        return result.meta.changes === 0 ? json({ error: "Not found" }, 404) : json({ ok: true });
      },
      OPTIONS: () => optionsResponse(),
    },
  },
});
