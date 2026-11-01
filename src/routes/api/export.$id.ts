import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { denyUnlessViewable } from "@/lib/access.server";
import { getSessionUser } from "@/lib/auth.server";
import { withCors } from "@/lib/api.server";
import { getUploadById } from "@/lib/uploads.server";

/** Downloads the rendered MP4, named after the video. */
export const Route = createFileRoute("/api/export/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id);
        const denied = await denyUnlessViewable(upload, request);
        if (denied) return denied;
        if (upload && !upload.downloadsEnabled && upload.ownerId !== (await getSessionUser(request))?.sub) {
          return withCors(new Response("Downloads are turned off for this video", { status: 403 }));
        }
        if (!upload?.exportKey) return withCors(new Response("Not found", { status: 404 }));
        const object = await env.BUCKET.get(upload.exportKey);
        if (!object) return withCors(new Response("Not found", { status: 404 }));
        const name = (upload.title?.trim() || "video").replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "video";
        return withCors(
          new Response(object.body, {
            headers: {
              "content-type": "video/mp4",
              "content-length": String(object.size),
              "content-disposition": `attachment; filename="${name}.mp4"`,
              "cache-control": "private, max-age=0",
            },
          }),
        );
      },
    },
  },
});
