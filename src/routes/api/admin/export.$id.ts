import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json, protectedApi } from "@/lib/api.server";

/** Operator trigger for an export (UPLOAD_TOKEN), for testing the render pipeline. */
export const Route = createFileRoute("/api/admin/export/$id")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        protectedApi(request, env.UPLOAD_TOKEN, async () => {
          const result = await db
            .update(uploads)
            .set({ exportStatus: "pending" })
            .where(eq(uploads.id, params.id));
          if (result.meta.changes === 0) return json({ error: "Not found" }, 404);
          await env.PROCESS_QUEUE.send({ id: params.id, kind: "export", origin: new URL(request.url).origin });
          return json({ status: "pending" }, 202);
        }),
    },
  },
});
