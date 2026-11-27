import { noteLifecycleEvent } from "@/lib/lifecycle-events.server";
import { captureServer } from "@/lib/posthog.server";
import { recordingEntry } from "@/lib/posthog-events";
import { createFileRoute } from "@tanstack/react-router";
import { env, waitUntil } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { uploadParts, uploads } from "@/db/schema";
import { json } from "@/lib/api.server";
import { deleteLive } from "@/lib/live.server";
import { notify } from "@/lib/slack.server";
import { emitWebhook } from "@/lib/webhooks";
import { countRecorderActivation } from "@/lib/activation-events.server";
import { settleReferral } from "@/lib/referrals.server";
import { recordingPartCoordinationAvailable, recordingPartStore, type CoordinatedPart } from "@/lib/recording-parts.server";
import { getSessionUser, type SessionUser } from "@/lib/auth.server";
import { ownedCompletionTarget, ownedUpload, recordingLifecycleOptimized, retryRecordingD1, recordingSession, userApi } from "@/lib/recordings.server";
import { queuePoster } from "@/lib/poster.server";
import { MAX_RECORDING_SECONDS, completeSchema } from "@/lib/recording-limit";

async function finishTrack(
  uploadId: string,
  track: "screen" | "camera",
  key: string,
  multipartId: string,
  expected: number,
  coordinatedParts?: CoordinatedPart[],
  recoverAcknowledgment = false,
): Promise<R2Object | "missing-parts"> {
  const parts = coordinatedParts?.filter((part) => part.track === track) ?? await db
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
  const acceptedParts = parts.map(({ partNumber, etag }) => ({ partNumber, etag }));
  const complete = () => env.BUCKET.resumeMultipartUpload(key, multipartId).complete(acceptedParts);
  const completion = complete();
  if (!recoverAcknowledgment) return completion;
  try {
    return await completion;
  } catch (error) {
    const completed = await env.BUCKET.head(key).catch(() => null);
    if (completed) return completed;
    throw error;
  }
}

type CompletionAccess = {
  upload: NonNullable<Awaited<ReturnType<typeof ownedUpload>>>;
  target: Awaited<ReturnType<typeof ownedCompletionTarget>>;
};

async function completeRecording(
  request: Request,
  id: string,
  user: SessionUser,
  coordinatedParts?: CoordinatedPart[],
  optimized = false,
  access?: CompletionAccess,
) {
  const target = access ? access.target : optimized ? await retryRecordingD1(() => ownedCompletionTarget(id, user)) : null;
  const upload = access ? access.upload : optimized ? target?.upload : await ownedUpload(id, user);
  if (!upload) return json({ error: "Recording not found" }, 404);
  const url = `${new URL(request.url).origin}/${upload.id}`;
  if (upload.status === "ready") return json({ id: upload.id, url });
  if (!coordinatedParts && recordingPartStore(upload)) {
    throw new Error("Coordinated recording completion requires its multipart ledger");
  }
  if (!upload.multipartUploadId) {
    return json({ error: "Recording has no upload" }, 409);
  }
  const body: unknown = await request.json().catch(() => null);
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    // The uploaded parts are kept, so the client can finish again with a valid length.
    const reported = (body as { duration?: unknown } | null)?.duration;
    if (typeof reported === "number" && reported > MAX_RECORDING_SECONDS) {
      return json(
        { error: "Recordings can run up to six hours, so this one can't be finished as it is.", code: "too_long", maxSeconds: MAX_RECORDING_SECONDS },
        422,
      );
    }
    return json({ error: "Invalid completion" }, 400);
  }

  const screen = await finishTrack(
    upload.id,
    "screen",
    upload.r2Key,
    upload.multipartUploadId,
    parsed.data.partCount,
    coordinatedParts,
    optimized,
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
            coordinatedParts,
            optimized,
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
  const save = () => db.batch([
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
  // The coordinator serializes completion. The same ready update and parts deletion can be replayed.
  if (optimized) await retryRecordingD1(save);
  else await save();
  await deleteLive(upload.id).catch(() => {});
  // The video is saved. Counting it and telling Slack are a dozen database trips and a call out,
  // so the recorder doesn't wait for them.
  const afterSave = (async () => {
    if (upload.ownerId) {
      await noteLifecycleEvent(upload.ownerId, "recorded");
      const activation = await countRecorderActivation(upload.ownerId, upload.id, upload.createdAt);
      await settleReferral(upload.ownerId);
      captureServer(
        "recording_completed",
        upload.ownerId,
        { duration: parsed.data.duration, has_camera: cameraKept, surface: upload.captureSurface ?? null, entry: recordingEntry(request), activation: activation ?? "none" },
        activation === "first_recording" ? { setOnce: { first_recording_on: new Date().toISOString().slice(0, 10) } } : {},
      );
    }
    await notify(upload.workspaceId, `New video: ${upload.title || "Untitled"}\n${url}`);
  })().catch(() => {});
  waitUntil(afterSave);
  if (willProcess) await env.PROCESS_QUEUE.send({ id: upload.id });
  await queuePoster(upload.id);
  emitWebhook(upload.workspaceId, "video.ready", { id: upload.id, url, title: upload.title, duration: parsed.data.duration });
  return json({ id: upload.id, url, camera: cameraKept });
}

export const Route = createFileRoute("/api/recordings/$id/complete")({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const coordinationAvailable = recordingPartCoordinationAvailable();
        const optimized = coordinationAvailable && recordingLifecycleOptimized();
        return userApi(request, async (user) => {
          if (!coordinationAvailable) return completeRecording(request, params.id, user);
          const target = optimized ? await retryRecordingD1(() => ownedCompletionTarget(params.id, user)) : null;
          const upload = optimized ? target?.upload : await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
          const store = upload.status === "recording" ? recordingPartStore(upload) : null;
          if (!store) return completeRecording(request, params.id, user, undefined, optimized, { upload, target });
          return await store.finish(async (parts, waited) => {
            const currentUser = waited
              ? await (optimized ? recordingSession(request) : getSessionUser(request))
              : user;
            if (!currentUser) return json({ error: "Sign in first" }, 401);
            return completeRecording(request, params.id, currentUser, parts, optimized);
          });
        }, { recordingLifecycle: optimized });
      },
    },
  },
});
