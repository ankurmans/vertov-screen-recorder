import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json } from "@/lib/api.server";
import { ownedUpload, userApi } from "@/lib/recordings.server";
import { posterSource, queuePoster } from "@/lib/poster.server";
import { trackMasks } from "@/lib/viewer-masks";

// Every kind listed here is accepted. `column` is the upload field that points at the file; the others are only read from R2.
const KINDS = {
  // Audio-only copy of the narration, small enough to hand straight to Whisper.
  audio: { maxBytes: 100 * 1024 * 1024, types: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"], column: "audioKey" },
  poster: { maxBytes: 5 * 1024 * 1024, types: ["image/jpeg", "image/webp", "image/png"], column: "posterKey" },
  gif: { maxBytes: 4 * 1024 * 1024, types: ["image/gif"], column: "gifKey" },
  // What happened on screen (clicks, pages) from the Chrome extension, for agent briefs. Read straight from R2.
  events: { maxBytes: 2 * 1024 * 1024, types: ["application/json"] },
} as const;

export const Route = createFileRoute("/api/recordings/$id/sidecar")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
          const kind = new URL(request.url).searchParams.get("kind");
          if (!kind || !Object.hasOwn(KINDS, kind)) return json({ error: "Unknown sidecar" }, 400);
          const contentType = (request.headers.get("content-type") || "")
            .split(";")[0]
            .trim();
          const size = Number(request.headers.get("content-length"));
          const spec = KINDS[kind as keyof typeof KINDS];
          if (!(spec.types as ReadonlyArray<string>).includes(contentType)) {
            return json({ error: "Unsupported type" }, 415);
          }
          if (!request.body || !(size > 0) || size > spec.maxBytes) {
            return json({ error: "Missing or oversized body" }, 413);
          }
          // The animated thumbnail is cut from the recording as captured, in the browser, so it cannot hide anything.
          if (kind === "gif" && Object.keys(trackMasks(upload)).length) return json({ error: "Videos with blurred areas have no animated thumbnail" }, 409);
          const key = `uploads/${upload.id}/${kind}`;
          // Posters say where they came from (see poster.server.ts). The owner's pick is "custom"; the recorder's and
          // file upload's instant first frame is replaced by the automatic pick, and never overwrites one.
          const custom = kind === "poster" && new URL(request.url).searchParams.get("source") === "custom";
          if (kind === "poster" && !custom && (await posterSource(upload.posterKey)) === "auto") return json({ stored: kind });
          await env.BUCKET.put(key, request.body, {
            httpMetadata: { contentType },
            ...(kind === "poster" ? { customMetadata: { source: custom ? "custom" : "first-frame" } } : {}),
          });
          if (kind === "poster" && !custom && upload.status === "ready") await queuePoster(upload.id);
          if ("column" in spec) {
            await db
              .update(uploads)
              .set({ [spec.column]: key })
              .where(eq(uploads.id, upload.id));
          }
          return json({ stored: kind });
        }),
    },
  },
});
