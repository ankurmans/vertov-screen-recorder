import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { uploadParts, uploads } from "@/db/schema";
import { json } from "@/lib/api.server";
import { deleteLive } from "@/lib/live.server";
import { notify } from "@/lib/slack.server";
import { emitWebhook } from "@/lib/webhooks";
import { countRecorderActivation } from "@/lib/activation-events.server";
import { ownedUpload, userApi } from "@/lib/recordings.server";

const completeSchema = z.object({
  duration: z.number().finite().nonnegative().max(60 * 60 * 6),
  width: z.number().int().positive().max(16384).nullable().optional(),
  height: z.number().int().positive().max(16384).nullable().optional(),
  partCount: z.number().int().min(1).max(10_000),
  // 0 or missing: the camera track was dropped and its upload is abandoned.
  cameraPartCount: z.number().int().min(0).max(10_000).optional(),
});

async function finishTrack(
  uploadId: string,
  track: "screen" | "camera",
  key: string,
  multipartId: string,
  expected: number,
): Promise<R2Object | "missing-parts"> {
  const parts = await db
    .select()
    .from(uploadParts)
    .where(and(eq(uploadParts.uploadId, uploadId), eq(uploadParts.track, track)))
    .orderBy(asc(uploadParts.partNumber));
  if (parts.length !== expected || parts.some((part, index) => part.partNumber !== index + 1)) {
    return "missing-parts";
  }
  // A lost response must not require completing R2 twice.
  const existing = await env.BUCKET.head(key);
  if (existing) return existing;
  return env.BUCKET.resumeMultipartUpload(key, multipartId).complete(
    parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
  );
}

export const Route = createFileRoute("/api/recordings/$id/complete")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
          const url = `${new URL(request.url).origin}/${upload.id}`;
          if (upload.status === "ready") return json({ id: upload.id, url });
          if (!upload.multipartUploadId) {
            return json({ error: "Recording has no upload" }, 409);
          }
          const parsed = completeSchema.safeParse(
            await request.json().catch(() => null),
          );
          if (!parsed.success) return json({ error: "Invalid completion" }, 400);

          const screen = await finishTrack(
            upload.id,
            "screen",
            upload.r2Key,
            upload.multipartUploadId,
            parsed.data.partCount,
          );
          if (screen === "missing-parts") {
            return json({ error: "Some parts haven't arrived yet" }, 409);
          }

          let cameraKept = false;
          if (upload.cameraKey && upload.cameraMultipartUploadId) {
            const cameraParts = parsed.data.cameraPartCount ?? 0;
            const camera =
              cameraParts > 0
                ? await finishTrack(
                    upload.id,
                    "camera",
                    upload.cameraKey,
                    upload.cameraMultipartUploadId,
                    cameraParts,
                  )
                : "missing-parts";
            cameraKept = camera !== "missing-parts";
            if (!cameraKept) {
              // The screen alone is still a good video; drop the half camera track.
              await env.BUCKET.resumeMultipartUpload(upload.cameraKey, upload.cameraMultipartUploadId)
                .abort()
                .catch(() => {});
            }
          }

          const willProcess = Boolean(upload.audioKey);
          await db.batch([
            db
              .update(uploads)
              .set({
                status: "ready",
                size: screen.size,
                duration: parsed.data.duration,
                width: parsed.data.width ?? upload.width,
                height: parsed.data.height ?? upload.height,
                multipartUploadId: null,
                cameraMultipartUploadId: null,
                ...(cameraKept ? {} : { cameraKey: null, cameraContentType: null }),
                aiStatus: willProcess ? "pending" : null,
              })
              .where(eq(uploads.id, upload.id)),
            db.delete(uploadParts).where(eq(uploadParts.uploadId, upload.id)),
          ]);
          await deleteLive(upload.id).catch(() => {});
          if (upload.ownerId) await countRecorderActivation(upload.ownerId, upload.id, upload.createdAt);
          if (willProcess) await env.PROCESS_QUEUE.send({ id: upload.id });
          await notify(upload.workspaceId, `New video: ${upload.title || "Untitled"}\n${url}`);
          emitWebhook(upload.workspaceId, "video.ready", { id: upload.id, url, title: upload.title, duration: parsed.data.duration });
          return json({ id: upload.id, url, camera: cameraKept });
        }),
    },
  },
});
