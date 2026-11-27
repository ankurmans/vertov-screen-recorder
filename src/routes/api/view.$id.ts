import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { denyUnlessViewable } from "@/lib/access.server";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { json, optionsResponse } from "@/lib/api.server";
import { getSessionUser } from "@/lib/auth.server";
import { cacheIfPublic, cachedTarget, isAnonymous, targetFor, viewsOverLimit } from "@/lib/ping-target.server";
import type { PingTarget } from "@/lib/ping-target.server";
import { ensureSchema } from "@/lib/uploads.server";
import { submitView } from "@/lib/viewer-events.server";

const bodySchema = z.object({
  // document.referrer of the visit; older clients send no body at all.
  referrer: z.string().max(2048).nullable().optional(),
});

/**
 * View counter ping. The client sends this once per viewer per share
 * (localStorage-guarded) to reduce repeat browser opens, not count unique people.
 * Each ping records viewer geo (Cloudflare request metadata), referrer, and device.
 * The counting itself is batched by viewer-events.server.ts, so a viral video does not become one D1 write per viewer.
 */
export const Route = createFileRoute("/api/view/$id")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        await ensureSchema();
        // A link anyone may watch, pinged by someone not signed in, is answered from the edge cache with no D1 read.
        const anonymous = isAnonymous(request);
        let target = anonymous ? await cachedTarget(params.id) : null;
        if (!target) {
          const upload = await db.query.uploads.findFirst({ where: eq(uploads.id, params.id) });
          if (!upload) return json({ error: "Upload not found" }, 404);
          const denied = await denyUnlessViewable(upload, request);
          if (denied) return denied;
          const viewer = upload.ownerId ? await getSessionUser(request) : null;
          // The recorder's own plays don't count as anyone watching, so they don't keep a video alive either.
          if (viewer && viewer.sub === upload.ownerId) return json({ ok: true, owner: true });
          target = await targetFor(upload);
          if (anonymous) await cacheIfPublic(upload, target);
          return await count(request, target, viewer?.sub ?? null);
        }
        return await count(request, target, null);
      },
      OPTIONS: () => optionsResponse(),
    },
  },
});

async function count(request: Request, target: PingTarget, viewer: string | null): Promise<Response> {
  if (await viewsOverLimit(target)) return json({ ok: true, limited: true });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const referrer = parsed.success ? parsed.data.referrer?.trim() || null : null;
  const cf = (request as Request & { cf?: { country?: string; city?: string } }).cf;
  await submitView({
    kind: "view",
    uploadId: target.id,
    at: new Date().toISOString(),
    ownerId: target.ownerId,
    workspaceId: target.workspaceId,
    title: target.title,
    mediaType: target.mediaType,
    ready: target.ready,
    viewer,
    referrer,
    country: cf?.country ?? request.headers.get("cf-ipcountry"),
    city: cf?.city ?? null,
    device: deviceFromUserAgent(request.headers.get("user-agent")),
    origin: new URL(request.url).origin,
    free: target.free,
  });
  return json({ ok: true });
}

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
