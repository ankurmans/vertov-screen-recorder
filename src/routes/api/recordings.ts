import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json } from "@/lib/api.server";
import { newShareId, userApi } from "@/lib/recordings.server";
import { spaceInWorkspace } from "@/lib/library.server";
import { getWorkspaceContext, libraryFullMessage } from "@/lib/workspace.server";

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
      POST: ({ request }) =>
        userApi(request, async (user) => {
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
          const { workspace } = await getWorkspaceContext(request, user);
          const full = await libraryFullMessage(workspace);
          if (full) return json({ error: full, code: "library_full" }, 402);
          if (parsed.data.spaceId && !(await spaceInWorkspace(parsed.data.spaceId, workspace.id))) {
            return json({ error: "Unknown space" }, 400);
          }
          const id = newShareId();
          const ext = (type: string) => (type === "video/mp4" ? "mp4" : "webm");
          const filename = `recording.${ext(contentType)}`;
          const key = `uploads/${id}/${filename}`;
          const multipart = await env.BUCKET.createMultipartUpload(key, {
            httpMetadata: { contentType },
          });
          const cameraKey = cameraType ? `uploads/${id}/camera.${ext(cameraType)}` : null;
          const cameraMultipart =
            cameraKey && cameraType
              ? await env.BUCKET.createMultipartUpload(cameraKey, {
                  httpMetadata: { contentType: cameraType },
                })
              : null;
          await db.insert(uploads).values({
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
          return json({ id, url: `${new URL(request.url).origin}/${id}` }, 201);
        }),
    },
  },
});
