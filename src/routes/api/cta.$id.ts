import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json, optionsResponse } from "@/lib/api.server";
import { ensureSchema } from "@/lib/uploads.server";

/** Counts a click on a video's call-to-action button. Only videos that have a button count. */
export const Route = createFileRoute("/api/cta/$id")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        await ensureSchema();
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
