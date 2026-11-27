import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { SessionUser } from "@/lib/auth.server";
import type { Upload } from "@/db/schema";
import { db } from "@/db";
import {
  comments,
  likes,
  reactions,
  uploadParts,
  uploads,
  viewEvents,
  viewProgress,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { isD1Overload, json } from "@/lib/api.server";
import { eventsDb } from "@/lib/events-db.server";
import { deleteLive } from "@/lib/live.server";
import { apiKeyUploadIdentity, getSessionUser, joinedUploadKey } from "@/lib/auth.server";
import { canManage, type Role } from "@/lib/plans";
import { trackError } from "@/lib/error-report.server";
import { HOSTED_EDITION } from "@/lib/edition";
import { getUploadById } from "@/lib/uploads.server";
import { recordingPartStore } from "@/lib/recording-parts.server";
import { roleIn } from "@/lib/workspace.server";

export const recordingLifecycleOptimized = () =>
  HOSTED_EDITION && Reflect.get(env, "RECORDING_LIFECYCLE_OPTIMIZED") === "1";

/** Retry short, replay-safe database operations with jitter to avoid synchronized retries. */
export async function retryRecordingD1<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 2 || !isD1Overload(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, (60 + Math.random() * 100) * (attempt + 1)));
    }
  }
}

export async function recordingSession(request: Request) {
  return retryRecordingD1(() => getSessionUser(request, { throwBackendErrors: true }));
}

/** Upload clients already retry server errors. Keep their credential check fresh on each attempt. */
export function recordingUploadSession(request: Request) {
  return getSessionUser(request, { throwBackendErrors: recordingLifecycleOptimized() });
}

/**
 * Runs the handler for a signed-in user; anything else gets a 401.
 * `sessionOnly` limits a route to the website: API keys and OAuth tokens get a 403. Set it on every route that changes
 * identity, billing, credentials or workspace access.
 */
export async function userApi(
  request: Request,
  handler: (user: SessionUser) => Promise<Response>,
  options: { sessionOnly?: boolean; recordingLifecycle?: boolean; recordingUpload?: boolean } = {},
): Promise<Response> {
  let user: SessionUser | null;
  const reportTransientFailure = options.recordingLifecycle || options.recordingUpload;
  if (reportTransientFailure) {
    try {
      user = await (options.recordingLifecycle ? recordingSession(request) : recordingUploadSession(request));
    } catch (error) {
      const message = isD1Overload(error) ? "D1 overloaded during recording session lookup" : "Recording session lookup failed";
      return recordingApiFailure(request, new Error(message, { cause: error }), undefined, true);
    }
  } else {
    user = await getSessionUser(request);
  }
  if (!user) return json({ error: "Sign in first" }, 401);
  if (options.sessionOnly && user.credential !== "session") return json({ error: "Use the website to do that" }, 403);
  try {
    return await handler(user);
  } catch (error) {
    return recordingApiFailure(request, error, user.sub, reportTransientFailure);
  }
}

function recordingApiFailure(request: Request, error: unknown, userId?: string, retryable = false): Response {
  const route = new URL(request.url).pathname;
  console.error(JSON.stringify({
    message: "Recording API failed",
    path: route,
    error: error instanceof Error ? error.message : String(error),
  }));
  trackError(error, { source: "api", route, userId });
  if (retryable && isD1Overload(error)) {
    return json({ error: "Recording service is busy. Please try again." }, { status: 503, headers: { "Retry-After": "1" } });
  }
  return json({ error: "Internal server error" }, 500);
}

function canControlUpload(
  upload: Pick<Upload, "ownerId" | "workspaceId">,
  user: Pick<SessionUser, "sub">,
  role: Role | null,
): boolean {
  const ownsUpload = upload.ownerId === user.sub;
  return upload.workspaceId ? Boolean(role && (ownsUpload || canManage(role))) : ownsUpload;
}

/**
 * The upload when the user may change it: they recorded it, or they run its workspace. Either way they must still
 * belong to the upload's workspace (a removed member keeps no control of what stays behind), and a key or token pinned
 * to one workspace reaches only that workspace's uploads. An upload with no workspace belongs to its recorder alone.
 * Unknown and foreign look the same.
 */
export async function ownedUpload(
  id: string,
  user: SessionUser,
): Promise<Upload | null> {
  const upload = await getUploadById(id);
  if (!upload) return null;
  if (user.workspaceId && upload.workspaceId !== user.workspaceId) return null;
  const role = upload.workspaceId ? await roleIn(upload.workspaceId, user.sub) : null;
  return canControlUpload(upload, user, role) ? upload : null;
}

/** Load completion metadata and fresh membership from the same primary database read. */
export async function ownedCompletionTarget(id: string, user: SessionUser) {
  const row = await db.select({ upload: uploads, workspace: workspaces, role: workspaceMembers.role })
    .from(uploads)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, uploads.workspaceId), eq(workspaceMembers.userId, user.sub)))
    .leftJoin(workspaces, eq(workspaces.id, uploads.workspaceId))
    .where(eq(uploads.id, id))
    .get();
  if (!row || (user.workspaceId && row.upload.workspaceId !== user.workspaceId)) return null;
  const role = row.role as Role | null;
  return canControlUpload(row.upload, user, role) ? { ...row, role } : null;
}

/** Read only the live chunk target and its current membership in one D1 statement. */
export async function ownedLiveUpload(
  id: string,
  user: SessionUser,
): Promise<Pick<Upload, "id" | "status"> | null> {
  const upload = await env.DB.prepare(
    `SELECT u.id, u.status, u.owner_id AS ownerId, u.workspace_id AS workspaceId, m.role
     FROM uploads u
     LEFT JOIN workspace_members m ON m.workspace_id = u.workspace_id AND m.user_id = ?1
     WHERE u.id = ?2 AND (?3 IS NULL OR u.workspace_id = ?3)`,
  ).bind(user.sub, id, user.workspaceId || null).first<
    Pick<Upload, "id" | "status" | "ownerId" | "workspaceId"> & { role: Role | null }
  >();
  if (!upload || !canControlUpload(upload, user, upload.role)) return null;
  return { id: upload.id, status: upload.status };
}

type LiveUploadTarget = Pick<Upload, "id" | "status">;
type UploadWriteTarget = LiveUploadTarget & {
  r2Key?: string | null;
  multipartUploadId?: string | null;
  cameraKey?: string | null;
  cameraMultipartUploadId?: string | null;
};

export function liveUploadApi(
  request: Request,
  id: string,
  handler: (upload: LiveUploadTarget) => Promise<Response>,
): Promise<Response> {
  return recordingUploadApi(request, id, "live", handler);
}

export function partUploadApi(
  request: Request,
  id: string,
  handler: (upload: UploadWriteTarget) => Promise<Response>,
): Promise<Response> {
  return recordingUploadApi(request, id, "parts", handler);
}

async function recordingUploadApi(
  request: Request,
  id: string,
  kind: "live" | "parts",
  handler: (upload: UploadWriteTarget) => Promise<Response>,
): Promise<Response> {
  const missing = () => json({ error: "Recording not found" }, 404);
  const optimized = recordingLifecycleOptimized();
  const key = joinedUploadKey(request, kind);
  if (key === null) {
    return userApi(request, async (user) => {
      const upload = await (kind === "live" ? ownedLiveUpload(id, user) : ownedUpload(id, user));
      return upload ? handler(upload) : missing();
    }, { recordingUpload: optimized });
  }
  let userId: string | undefined;
  try {
    const identity = await apiKeyUploadIdentity(key, id, kind);
    if (!identity) return json({ error: "Sign in first" }, 401);
    userId = identity.userId;
    if (identity.uploadId === null || identity.uploadStatus === null || !canControlUpload(
      { ownerId: identity.uploadOwnerId, workspaceId: identity.workspaceId },
      { sub: userId },
      identity.role ?? null,
    )) return missing();
    return await handler({
      id: identity.uploadId,
      status: identity.uploadStatus,
      r2Key: identity.r2Key,
      multipartUploadId: identity.multipartUploadId,
      cameraKey: identity.cameraKey,
      cameraMultipartUploadId: identity.cameraMultipartUploadId,
    });
  } catch (error) {
    return recordingApiFailure(request, error, userId, optimized);
  }
}

export async function deleteUpload(upload: Upload): Promise<void> {
  const store = upload.status === "recording" ? recordingPartStore(upload) : null;
  if (store) await store.remove(() => deleteUploadFiles(upload));
  else await deleteUploadFiles(upload);
}

async function deleteUploadFiles(upload: Upload): Promise<void> {
  if (upload.status === "recording") {
    await deleteLive(upload.id).catch(() => {});
    if (upload.multipartUploadId) {
      await env.BUCKET.resumeMultipartUpload(upload.r2Key, upload.multipartUploadId)
        .abort()
        .catch(() => {});
    }
    if (upload.cameraKey && upload.cameraMultipartUploadId) {
      await env.BUCKET.resumeMultipartUpload(upload.cameraKey, upload.cameraMultipartUploadId)
        .abort()
        .catch(() => {});
    }
  }
  // The video's own files, and any images placed on it, which are kept outside its folder.
  for (const prefix of [`uploads/${upload.id}/`, `uploads/overlays/${upload.id}/`]) {
    let cursor: string | undefined;
    do {
      const listed = await env.BUCKET.list({ prefix, cursor });
      if (listed.objects.length > 0) await env.BUCKET.delete(listed.objects.map((object) => object.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  // Viewer events live in their own database (events-db.server.ts); a failure there leaves rows that are never read.
  await eventsDb().batch([
    eventsDb().delete(viewEvents).where(eq(viewEvents.uploadId, upload.id)),
    eventsDb().delete(viewProgress).where(eq(viewProgress.uploadId, upload.id)),
  ])
  await db.batch([
    db.delete(uploadParts).where(eq(uploadParts.uploadId, upload.id)),
    db.delete(comments).where(eq(comments.uploadId, upload.id)),
    db.delete(likes).where(eq(likes.uploadId, upload.id)),
    db.delete(reactions).where(eq(reactions.uploadId, upload.id)),
    db.delete(uploads).where(eq(uploads.id, upload.id)),
  ]);
}

/** Short hex id, matching the share route's /^[a-f0-9]{8}$/. */
export const newShareId = () => crypto.randomUUID().split("-")[0];
