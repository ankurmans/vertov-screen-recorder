import { denyUnlessViewable } from "@/lib/access.server";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json } from "@/lib/api.server";
import { getSessionUser } from "@/lib/auth.server";
import { cacheIfPublic, cachedTarget, isAnonymous, progressOverLimit, targetFor } from "@/lib/ping-target.server";
import { getUploadById } from "@/lib/uploads.server";
import { submitProgress } from "@/lib/viewer-events.server";

const bodySchema = z.object({
  viewerKey: z.string().min(8).max(64),
  percent: z.number().finite().min(0).max(1),
  seconds: z.number().finite().min(0).max(60 * 60 * 24),
});

/** Watch-progress pings from the share page; the owner's own plays don't count. */
export const Route = createFileRoute("/api/progress/$id")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid progress" }, 400);
        // Anonymous viewers of a link anyone may watch are answered from the edge cache with no D1 read (ping-target.server.ts).
        const anonymous = isAnonymous(request);
        let target = anonymous ? await cachedTarget(params.id) : null;
        let user: Awaited<ReturnType<typeof getSessionUser>> = null;
        if (!target) {
          const upload = await getUploadById(params.id);
          if (!upload) return json({ error: "Not found" }, 404);
          const denied = await denyUnlessViewable(upload, request);
          if (denied) return denied;
          user = await getSessionUser(request);
          if (user && user.sub === upload.ownerId) return json({ ok: true, owner: true });
          target = await targetFor(upload);
          if (anonymous) await cacheIfPublic(upload, target);
        }
        const cf = (request as Request & { cf?: { country?: string; city?: string } }).cf;
        const viewerKey = user ? `user:${user.sub}` : `anon:${parsed.data.viewerKey}`;
        if (await progressOverLimit(target.id, viewerKey)) return json({ ok: true, limited: true });
        await submitProgress({
          kind: "progress",
          uploadId: target.id,
          workspaceId: target.workspaceId,
          viewerKey,
          viewerName: user?.name ?? null,
          viewerAvatar: user?.avatar ?? null,
          percent: parsed.data.percent,
          seconds: parsed.data.seconds,
          country: cf?.country ?? null,
          city: cf?.city ?? null,
          free: target.free,
        });
        return json({ ok: true });
      },
    },
  },
});
