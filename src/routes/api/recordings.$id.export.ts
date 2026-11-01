import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json } from "@/lib/api.server";
import { exportSignature } from "@/lib/export.server";
import { ownedUpload, userApi } from "@/lib/recordings.server";

/**
 * MP4 with the layout baked in. POST starts a render unless a fresh one
 * exists; GET reports where it's at so the page can poll.
 */
export const Route = createFileRoute("/api/recordings/$id/export")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Not found" }, 404);
          const fresh = upload.exportStatus === "done" && upload.exportSignature === exportSignature(upload);
          return json({ status: fresh ? "done" : upload.exportStatus === "done" ? "stale" : upload.exportStatus });
        }),
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload || upload.status !== "ready") return json({ error: "Not found" }, 404);
          const fresh = upload.exportStatus === "done" && upload.exportSignature === exportSignature(upload);
          if (fresh) return json({ status: "done" });
          if (upload.exportStatus !== "pending") {
            await db.update(uploads).set({ exportStatus: "pending" }).where(eq(uploads.id, upload.id));
            await env.PROCESS_QUEUE.send({ id: upload.id, kind: "export", origin: new URL(request.url).origin });
          }
          return json({ status: "pending" }, 202);
        }),
    },
  },
});
