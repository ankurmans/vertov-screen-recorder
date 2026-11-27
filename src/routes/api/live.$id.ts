import { createFileRoute } from "@tanstack/react-router";
import { denyUnlessViewable } from "@/lib/access.server";
import { json, optionsResponse } from "@/lib/api.server";
import { liveState } from "@/lib/live.server";
import { getUploadById } from "@/lib/uploads.server";

/** What a live viewer needs: how many chunks exist, their media type, and whether recording is over. */
export const Route = createFileRoute("/api/live/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id);
        const denied = await denyUnlessViewable(upload, request);
        if (denied) return denied;
        if (!upload) return json({ error: "Not found" }, 404);
        if (upload.status !== "recording") return json({ status: upload.status, count: 0, mime: null });
        const { count, mime } = await liveState(upload.id);
        return json({ status: upload.status, count, mime }, { headers: { "cache-control": "no-store" } });
      },
      OPTIONS: () => optionsResponse(),
    },
  },
});
