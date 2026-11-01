import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";
import { putChunk } from "@/lib/live.server";
import { ownedUpload, userApi } from "@/lib/recordings.server";

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

/** The recorder sends each few seconds of video here too, so viewers can watch and rewind before it ends. */
export const Route = createFileRoute("/api/recordings/$id/live")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
          if (upload.status !== "recording") return json({ error: "Recording is already finished" }, 409);
          const n = Number(new URL(request.url).searchParams.get("n"));
          const mime = request.headers.get("x-live-mime") ?? "";
          if (!Number.isInteger(n) || !/^video\/(mp4|webm)/.test(mime)) return json({ error: "A chunk number and media type are required" }, 400);
          const body = await request.arrayBuffer();
          if (body.byteLength === 0 || body.byteLength > MAX_CHUNK_BYTES) return json({ error: "Bad chunk size" }, 413);
          return (await putChunk(upload.id, n, body, mime)) ? json({ ok: true }) : json({ error: "Too many chunks" }, 400);
        }),
    },
  },
});
