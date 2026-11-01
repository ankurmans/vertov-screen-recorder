import { eq } from "drizzle-orm";
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
} from "@/db/schema";
import { json } from "@/lib/api.server";
import { deleteLive } from "@/lib/live.server";
import { getSessionUser } from "@/lib/auth.server";
import { canManage } from "@/lib/plans";
import { getUploadById } from "@/lib/uploads.server";
import { roleIn } from "@/lib/workspace.server";

/** Runs the handler for a signed-in user; anything else gets a 401. */
export async function userApi(
  request: Request,
  handler: (user: SessionUser) => Promise<Response>,
): Promise<Response> {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "Sign in first" }, 401);
  try {
    return await handler(user);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Recording API failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ error: "Internal server error" }, 500);
  }
}

/**
 * The upload when the user may change it: they recorded it, or they run its workspace.
 * Unknown and foreign look the same.
 */
export async function ownedUpload(
  id: string,
  user: SessionUser,
): Promise<Upload | null> {
  const upload = await getUploadById(id);
  if (!upload) return null;
  if (upload.ownerId === user.sub) return upload;
  return canManage(await roleIn(upload.workspaceId, user.sub)) ? upload : null;
}

export async function deleteUpload(upload: Upload): Promise<void> {
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
  const listed = await env.BUCKET.list({ prefix: `uploads/${upload.id}/` });
  if (listed.objects.length > 0) {
    await env.BUCKET.delete(listed.objects.map((object) => object.key));
  }
  await db.batch([
    db.delete(uploadParts).where(eq(uploadParts.uploadId, upload.id)),
    db.delete(comments).where(eq(comments.uploadId, upload.id)),
    db.delete(likes).where(eq(likes.uploadId, upload.id)),
    db.delete(viewEvents).where(eq(viewEvents.uploadId, upload.id)),
    db.delete(reactions).where(eq(reactions.uploadId, upload.id)),
    db.delete(viewProgress).where(eq(viewProgress.uploadId, upload.id)),
    db.delete(uploads).where(eq(uploads.id, upload.id)),
  ]);
}

/** Short hex id, matching the share route's /^[a-f0-9]{8}$/. */
export const newShareId = () => crypto.randomUUID().split("-")[0];
