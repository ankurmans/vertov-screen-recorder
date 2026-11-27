import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { db } from "@/db";
import { uploadParts } from "@/db/schema";
import { json } from "@/lib/api.server";
import { recordingPartStore } from "@/lib/recording-parts.server";
import { MAX_RECORDING_BYTES } from "@/lib/recording-limit";
import { ownedLiveUpload, partUploadApi, recordingUploadSession } from "@/lib/recordings.server";

const partNumberSchema = z.coerce.number().int().min(1).max(10_000);
// R2 needs every part but the last to be the same size; the recorder uses 5 MiB.
const MAX_PART_BYTES = 64 * 1024 * 1024;

export const Route = createFileRoute("/api/recordings/$id/parts")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        partUploadApi(request, params.id, async (upload) => {
          const search = new URL(request.url).searchParams;
          const track = search.get("track") === "camera" ? "camera" : "screen";
          const key = track === "camera" ? upload.cameraKey : upload.r2Key;
          const multipartId =
            track === "camera" ? upload.cameraMultipartUploadId : upload.multipartUploadId;
          if (upload.status !== "recording" || !key || !multipartId) {
            return json({ error: "Recording is already finished" }, 409);
          }
          const partNumber = partNumberSchema.safeParse(search.get("part"));
          const size = Number(request.headers.get("content-length"));
          const body = request.body;
          if (!partNumber.success || !body || !(size > 0)) {
            return json({ error: "A part number and body are required" }, 400);
          }
          if (size > MAX_PART_BYTES) return json({ error: "Part too large" }, 413);
          const writePart = () => env.BUCKET.resumeMultipartUpload(key, multipartId).uploadPart(partNumber.data, body);
          const tooLarge = () => json({ error: "This recording is larger than a recording can be", code: "too_large", maxBytes: MAX_RECORDING_BYTES }, 413);
          const store = recordingPartStore(upload);
          if (store) {
            const pending = store.uploadPart(track, partNumber.data, size, writePart, async () => {
              const currentUser = await recordingUploadSession(request);
              if (!currentUser) return 401;
              return await ownedLiveUpload(upload.id, currentUser) ? null : 404;
            });
            const result = await pending;
            if (result.outcome === "denied") {
              return result.status === 401 ? json({ error: "Sign in first" }, 401) : json({ error: "Recording not found" }, 404);
            }
            if (result.outcome === "closed") return json({ error: "Recording is already finished" }, 409);
            if (result.outcome === "too_large") return tooLarge();
            return json({ partNumber: result.part.partNumber, etag: result.part.etag });
          }
          // What the recording already holds on both tracks, not counting the part this one replaces. A recording is held to
          // MAX_RECORDING_BYTES here because its row counts as nothing in the library until it is finished.
          const held = await env.DB.prepare(
            "SELECT coalesce(sum(size), 0) AS bytes FROM upload_parts WHERE upload_id = ? AND NOT (track = ? AND part_number = ?)",
          )
            .bind(upload.id, track, partNumber.data)
            .first<{ bytes: number }>();
          if ((held?.bytes ?? 0) + size > MAX_RECORDING_BYTES) {
            return tooLarge();
          }
          const part = await writePart();
          await db
            .insert(uploadParts)
            .values({ uploadId: upload.id, track, partNumber: part.partNumber, etag: part.etag, size })
            .onConflictDoUpdate({
              target: [uploadParts.uploadId, uploadParts.track, uploadParts.partNumber],
              set: { etag: part.etag, size },
            });
          return json({ partNumber: part.partNumber, etag: part.etag });
        }),
    },
  },
});
