import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { db } from "@/db";
import { uploadParts } from "@/db/schema";
import { json } from "@/lib/api.server";
import { ownedUpload, userApi } from "@/lib/recordings.server";

const partNumberSchema = z.coerce.number().int().min(1).max(10_000);
// R2 needs every part but the last to be the same size; the recorder uses 5 MiB.
const MAX_PART_BYTES = 64 * 1024 * 1024;

export const Route = createFileRoute("/api/recordings/$id/parts")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
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
          if (!partNumber.success || !request.body || !(size > 0)) {
            return json({ error: "A part number and body are required" }, 400);
          }
          if (size > MAX_PART_BYTES) return json({ error: "Part too large" }, 413);
          const part = await env.BUCKET.resumeMultipartUpload(key, multipartId).uploadPart(
            partNumber.data,
            request.body,
          );
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
