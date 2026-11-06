import { createFileRoute } from "@tanstack/react-router";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { denyUnlessViewable } from "@/lib/access.server";
import { SHARE_COUNTER_KEY, countAppEvent } from "@/lib/activation-events.server";
import { recordNotification } from "@/lib/notifications.server";
import { db } from "@/db";
import { uploads, viewEvents } from "@/db/schema";
import { json, optionsResponse } from "@/lib/api.server";
import { getSessionUser } from "@/lib/auth.server";
import { ensureSchema } from "@/lib/uploads.server";
import { emitWebhook } from "@/lib/webhooks";

const bodySchema = z.object({
  // document.referrer of the visit; older clients send no body at all.
  referrer: z.string().max(2048).nullable().optional(),
});

/**
 * View counter ping. The client sends this once per viewer per share
 * (localStorage-guarded) to reduce repeat browser opens, not count unique people.
 * Each ping records viewer geo (Cloudflare request metadata), referrer, and device.
 */
export const Route = createFileRoute("/api/view/$id")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        await ensureSchema();
        const upload = await db.query.uploads.findFirst({ where: eq(uploads.id, params.id) });
        if (!upload) return json({ error: "Upload not found" }, 404);
        const denied = await denyUnlessViewable(upload, request);
        if (denied) return denied;
        const viewer = upload?.ownerId ? await getSessionUser(request) : null;
        // The recorder's own plays don't count as anyone watching, so they don't keep a video alive either.
        const byOwner = Boolean(viewer && viewer.sub === upload.ownerId);
        if (byOwner) return json({ ok: true, owner: true });
        const result = await db
          .update(uploads)
          .set({
            views: sql`${uploads.views} + 1`,
            lastViewedAt: new Date().toISOString(),
            retentionNoticeAt: null,
            retentionFinalAt: null,
          })
          .where(eq(uploads.id, params.id));
        if (result.meta.changes === 0) {
          return json({ error: "Upload not found" }, 404);
        }
        // Someone other than the owner opened the link for the first time: the observable result of sharing a video.
        if (upload.views === 0) await countAppEvent({ key: SHARE_COUNTER_KEY, event: "first_external_view" });

        const parsed = bodySchema.safeParse(
          await request.json().catch(() => null),
        );
        const referrer = parsed.success
          ? parsed.data.referrer?.trim() || null
          : null;
        const cf = (
          request as Request & { cf?: { country?: string; city?: string } }
        ).cf;
        await db.insert(viewEvents).values({
          id: crypto.randomUUID(),
          uploadId: params.id,
          country: cf?.country ?? request.headers.get("cf-ipcountry"),
          city: cf?.city ?? null,
          referrer,
          device: deviceFromUserAgent(request.headers.get("user-agent")),
        });
        if (!byOwner) {
          if (upload) await recordNotification(upload, "view", viewer?.sub);
          emitWebhook(upload?.workspaceId, "video.viewed", {
            id: params.id,
            url: `${new URL(request.url).origin}/${params.id}`,
            title: upload?.title ?? null,
            country: cf?.country ?? null,
            referrer,
          });
        }

        return json({ ok: true });
      },
      OPTIONS: () => optionsResponse(),
    },
  },
});

/** Coarse device label from the User-Agent — enough for analytics. */
function deviceFromUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) {
    return /Mobile/i.test(userAgent) ? "Android" : "Android tablet";
  }
  if (/Macintosh/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/CrOS/i.test(userAgent)) return "ChromeOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Other";
}
