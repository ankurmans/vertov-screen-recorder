import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { json } from "@/lib/api.server";
import { ownedUpload, userApi } from "@/lib/recordings.server";
import { allow } from "@/lib/rate-limit.server";
import { recordLifecycleEvent } from "@/lib/lifecycle-events.server";
import { captureServer } from "@/lib/posthog.server";

// A copied link is sharing intent, not proof of sending or viewing. Never accept arbitrary events/recipients.
export const Route = createFileRoute("/api/recordings/$id/shared")({ server: { handlers: {
  POST: ({ request, params }) => userApi(request, async user => {
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403);
    const upload = await ownedUpload(params.id, user);
    if (!upload || upload.ownerId !== user.sub || upload.status !== "ready" || upload.mediaType !== "video" || upload.deletedAt) return json({ error: "Recording not found" }, 404);
    if (!await allow(`lifecycle-share:${user.sub}`, 30, 3600)) return json({ error: "Try later" }, 429);
    await recordLifecycleEvent(env.DB, user.sub, "shared");
    captureServer("recording_share_copied", user.sub);
    return json({ ok: true });
  }),
} } });
