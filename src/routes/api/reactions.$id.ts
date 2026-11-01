import { createFileRoute } from "@tanstack/react-router";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { reactions } from "@/db/schema";
import { denyUnlessViewable } from "@/lib/access.server";
import { json, optionsResponse } from "@/lib/api.server";
import { getSessionUser } from "@/lib/auth.server";
import { REACTION_EMOJIS } from "@/lib/reactions";
import { getUploadById } from "@/lib/uploads.server";


const createSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
  timestamp: z.number().finite().nonnegative().max(60 * 60 * 6),
  // Anonymous viewers get a random id kept in localStorage; signed-in viewers use their account.
  viewerId: z.string().min(8).max(64).optional(),
});

const MAX_PER_VIEWER = 100;

/** Emoji reactions pinned to a moment; anyone can react, no sign-in needed. */
export const Route = createFileRoute("/api/reactions/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const denied = await denyUnlessViewable(await getUploadById(params.id), request);
        if (denied) return denied;
        const rows = await db
          .select({
            id: reactions.id,
            emoji: reactions.emoji,
            timestamp: reactions.timestamp,
            viewerName: reactions.viewerName,
          })
          .from(reactions)
          .where(eq(reactions.uploadId, params.id))
          .orderBy(asc(reactions.timestamp))
          .limit(2000);
        return json({ reactions: rows });
      },
      POST: async ({ params, request }) => {
        const upload = await getUploadById(params.id);
        const denied = await denyUnlessViewable(upload, request);
        if (denied) return denied;
        if (!upload || !upload.socialEnabled) return json({ error: "Not found" }, 404);
        const parsed = createSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid reaction" }, 400);
        const user = await getSessionUser(request);
        const viewerId = user ? user.sub : parsed.data.viewerId ? `anon:${parsed.data.viewerId}` : null;
        if (!viewerId) return json({ error: "Missing viewer" }, 400);
        const [{ total }] = await db
          .select({ total: count() })
          .from(reactions)
          .where(and(eq(reactions.uploadId, upload.id), eq(reactions.viewerId, viewerId)));
        if (total >= MAX_PER_VIEWER) return json({ error: "That's a lot of love" }, 429);
        const reaction = {
          id: crypto.randomUUID(),
          uploadId: upload.id,
          viewerId,
          viewerName: user?.name ?? null,
          emoji: parsed.data.emoji,
          timestamp: parsed.data.timestamp,
        };
        await db.insert(reactions).values(reaction);
        return json(
          { reaction: { id: reaction.id, emoji: reaction.emoji, timestamp: reaction.timestamp, viewerName: reaction.viewerName } },
          201,
        );
      },
      OPTIONS: () => optionsResponse(),
    },
  },
});
