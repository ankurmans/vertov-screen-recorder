import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { denyUnlessViewable } from "@/lib/access.server";
import { withCors } from "@/lib/api.server";
import { chunkKey } from "@/lib/live.server";
import { getUploadById } from "@/lib/uploads.server";

export const Route = createFileRoute("/api/live/$id/$n")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id);
        const denied = await denyUnlessViewable(upload, request);
        if (denied) return denied;
        const n = Number(params.n);
        if (!upload || upload.status !== "recording" || !Number.isInteger(n)) return withCors(new Response("Not found", { status: 404 }));
        const object = await env.BUCKET.get(chunkKey(upload.id, n));
        if (!object) return withCors(new Response("Not found", { status: 404 }));
        return withCors(
          new Response(object.body, {
            headers: { "content-type": object.httpMetadata?.contentType ?? "video/mp4", "cache-control": "private, max-age=3600" },
          }),
        );
      },
    },
  },
});
