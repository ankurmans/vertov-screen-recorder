import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json } from "@/lib/api.server";
import { ownedUpload, userApi } from "@/lib/recordings.server";
import { posterSource, queuePoster } from "@/lib/poster.server";

const KINDS = {
  // Audio-only copy of the narration, small enough to hand straight to Whisper.
  audio: { maxBytes: 100 * 1024 * 1024, types: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"] },
  poster: { maxBytes: 5 * 1024 * 1024, types: ["image/jpeg", "image/webp", "image/png"] },
  gif: { maxBytes: 4 * 1024 * 1024, types: ["image/gif"] },
  // What happened on screen (clicks, pages) from the Chrome extension, for agent briefs. Read straight from R2.
  events: { maxBytes: 2 * 1024 * 1024, types: ["application/json"] },
  // The mouse path and click times, for cursor styles. Mapped to the recorded picture by cursorTrack().
  cursor: { maxBytes: 2 * 1024 * 1024, types: ["application/json"] },
} as const;

export const Route = createFileRoute("/api/recordings/$id/sidecar")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
          const kind = new URL(request.url).searchParams.get("kind");
          if (kind !== "audio" && kind !== "poster" && kind !== "events" && kind !== "gif") {
            return json({ error: "Unknown sidecar" }, 400);
          }
          const contentType = (request.headers.get("content-type") || "")
            .split(";")[0]
            .trim();
          const size = Number(request.headers.get("content-length"));
          const spec = KINDS[kind];
          if (!(spec.types as ReadonlyArray<string>).includes(contentType)) {
            return json({ error: "Unsupported type" }, 415);
          }
          if (!request.body || !(size > 0) || size > spec.maxBytes) {
            return json({ error: "Missing or oversized body" }, 413);
          }
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
          if (kind !== "events") {
            await db
              .update(uploads)
              .set(kind === "audio" ? { audioKey: key } : kind === "gif" ? { gifKey: key } : { posterKey: key })
              .where(eq(uploads.id, upload.id));
          }
          return json({ stored: kind });
        }),
    },
  },
});
