import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json } from "@/lib/api.server";
import { trackError } from "@/lib/error-report.server";
import { recordingEntry } from "@/lib/posthog-events";
import { captureServer } from "@/lib/posthog.server";
import { newShareId, recordingLifecycleOptimized, retryRecordingD1, userApi } from "@/lib/recordings.server";
import { spaceInWorkspace } from "@/lib/library.server";
import { getRecordingWorkspace, getWorkspaceContext, lengthRuleFor, libraryFullResponse } from "@/lib/workspace.server";

const startSchema = z.object({
  mimeType: z.string().min(1).max(200),
  // Set when the camera is recorded as its own track next to the screen.
  cameraMimeType: z.string().min(1).max(200).nullable().optional(),
  surface: z.enum(["monitor", "window", "browser", "camera", "upload"]).nullable().optional(),
  // Uploaded files arrive with their filename as a starting title.
  title: z.string().trim().min(1).max(200).nullable().optional(),
  width: z.number().int().positive().max(16384).nullable().optional(),
  height: z.number().int().positive().max(16384).nullable().optional(),
  // Record straight into a shared space instead of the recorder's own library.
  spaceId: z.string().max(64).nullable().optional(),
});

function containerOf(mimeType: string): "video/mp4" | "video/webm" | null {
  const type = mimeType.split(";")[0].trim();
  // QuickTime screen recordings are H.264 MP4s under the hood; browsers play them as MP4.
  if (type === "video/quicktime" || type === "video/x-m4v") return "video/mp4";
  return type === "video/mp4" || type === "video/webm" ? type : null;
}

/**
 * Starts a recording: the share link exists before the first frame, and
 * the recorder streams fixed-size parts into R2 multipart uploads (one for
 * the screen, one for the camera) while it records.
 */
export const Route = createFileRoute("/api/recordings")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const optimized = recordingLifecycleOptimized();
        return userApi(request, async (user) => {
          const parsed = startSchema.safeParse(
            await request.json().catch(() => null),
          );
          if (!parsed.success) return json({ error: "Invalid recording" }, 400);
          const contentType = containerOf(parsed.data.mimeType);
          const cameraType = parsed.data.cameraMimeType
            ? containerOf(parsed.data.cameraMimeType)
            : null;
          if (!contentType || (parsed.data.cameraMimeType && !cameraType)) {
            return json({ error: "Unsupported recording format" }, 400);
          }
          const { workspace, role } = optimized
            ? await retryRecordingD1(() => getRecordingWorkspace(request, user))
            : await getWorkspaceContext(request, user);
          const full = optimized
            ? await retryRecordingD1(() => libraryFullResponse(workspace, role))
            : await libraryFullResponse(workspace, role);
          if (full) return full;
          if (parsed.data.spaceId && !(await spaceInWorkspace(parsed.data.spaceId, workspace.id))) {
            return json({ error: "Unknown space" }, 400);
          }
          // Resolve the length rule before creating the multipart uploads on the optimized path.
          const getRule = () => parsed.data.surface === "upload"
            ? Promise.resolve({ capSeconds: null, enforce: false })
            : lengthRuleFor(workspace);
          const preflightRule = optimized ? await retryRecordingD1(getRule) : null;
          const id = newShareId();
          const ext = (type: string) => (type === "video/mp4" ? "mp4" : "webm");
          const filename = `recording.${ext(contentType)}`;
          const key = `uploads/${id}/${filename}`;
          const createMultipart = (objectKey: string, mime: string) => {
            const create = () => env.BUCKET.createMultipartUpload(objectKey, { httpMetadata: { contentType: mime } });
            return create();
          };
          const multipart = await createMultipart(key, contentType);
          const cameraKey = cameraType ? `uploads/${id}/camera.${ext(cameraType)}` : null;
          const abort = (upload: R2MultipartUpload) => upload.abort().catch((error) => {
            trackError(error, { source: "api", route: "/api/recordings", userId: user.sub });
          });
          const cameraMultipart =
            cameraKey && cameraType
              ? await createMultipart(cameraKey, cameraType).catch(async (error) => {
                  if (optimized) await abort(multipart);
                  throw error;
                })
              : null;
          const insert = () => db.insert(uploads).values({
            id,
            filename,
            contentType,
            size: 0,
            width: parsed.data.width ?? null,
            height: parsed.data.height ?? null,
            r2Key: key,
            mediaType: "video",
            ownerId: user.sub,
            status: "recording",
            multipartUploadId: multipart.uploadId,
            cameraKey,
            cameraContentType: cameraType,
            cameraMultipartUploadId: cameraMultipart?.uploadId ?? null,
            captureSurface: parsed.data.surface ?? null,
            title: parsed.data.title ?? null,
            workspaceId: workspace.id,
            spaceId: parsed.data.spaceId ?? null,
            visibility: workspace.defaultVisibility,
            downloadsEnabled: workspace.downloadsDefault,
          });
          if (optimized) {
            // Replaying this insert cannot create a second recording after a lost response.
            const [created] = await retryRecordingD1(() => insert().onConflictDoNothing({ target: uploads.id }).returning({ id: uploads.id }));
            if (!created) {
              const existing = await retryRecordingD1(() => db.select({ multipartId: uploads.multipartUploadId })
                .from(uploads).where(eq(uploads.id, id)).get());
              if (existing?.multipartId !== multipart.uploadId) {
                await Promise.all([abort(multipart), cameraMultipart && abort(cameraMultipart)]);
                throw new Error("Unable to allocate a unique recording ID");
              }
            }
          } else {
            await insert();
          }
          captureServer("recording_started", user.sub, { surface: parsed.data.surface ?? null, entry: recordingEntry(request), has_camera: Boolean(cameraType) });
          // Uploaded files are not recorded takes, so the length rule is for the recorders only.
          const rule = preflightRule ?? await getRule();
          return json({ id, url: `${new URL(request.url).origin}/${id}`, ...rule }, 201);
        }, { recordingLifecycle: optimized });
      },
    },
  },
});
