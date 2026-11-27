import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { json, optionsResponse, protectedApi } from "@/lib/api.server";
import { isVideoContentType } from "@/lib/uploads.server";

function numberHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  const number = value ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export const Route = createFileRoute("/api/upload/multipart")({
  server: {
    handlers: {
      POST: ({ request }) =>
        protectedApi(request, env.UPLOAD_TOKEN, async () => {
          const headers = request.headers;
          const filename = headers.get("x-filename");
          if (!filename)
            return json({ error: "X-Filename header is required" }, 400);
          const contentType =
            headers.get("content-type") || "application/octet-stream";
          let title: string | null;
          try {
            title =
              decodeURIComponent(headers.get("x-title") || "")
                .trim()
                .slice(0, 200) || null;
          } catch {
            return json({ error: "Invalid X-Title encoding" }, 400);
          }
          const metadata = {
            filename,
            contentType,
            width: numberHeader(headers, "x-width"),
            height: numberHeader(headers, "x-height"),
            duration: numberHeader(headers, "x-duration"),
            mediaType:
              headers.get("x-media-type") ||
              (isVideoContentType(contentType) ? "video" : "image"),
            title,
            socialEnabled: !["false", "0"].includes(
              headers.get("x-social-enabled") || "",
            ),
          };
          const id = crypto.randomUUID().split("-")[0];
          const key = `uploads/${id}/${filename}`;
          const upload = await env.BUCKET.createMultipartUpload(key, {
            httpMetadata: { contentType },
            customMetadata: {
              originalName: filename,
              uploadMetadata: JSON.stringify(metadata),
            },
          });
          return json({ id, key, uploadId: upload.uploadId }, 201);
        }),
      OPTIONS: () => optionsResponse(),
    },
  },
});
