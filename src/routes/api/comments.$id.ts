import { createFileRoute } from "@tanstack/react-router";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { denyUnlessViewable } from "@/lib/access.server";
import { json, optionsResponse } from "@/lib/api.server";
import { getSessionUser } from "@/lib/auth.server";
import { ensureSchema, getUploadById } from "@/lib/uploads.server";

const MAX_COMMENTS_PER_UPLOAD = 500;

const guestSecret = z.string().min(16).max(128);

const createSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  timestamp: z.number().finite().nonnegative().nullable().optional(),
  guest: z
    .object({ name: z.string().trim().min(1).max(60), secret: guestSecret })
    .optional(),
});

const updateSchema = z.object({
  commentId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(2000),
  guestSecret: guestSecret.optional(),
});

const deleteSchema = z.object({
  commentId: z.string().min(1).max(64),
  guestSecret: guestSecret.optional(),
});

/**
 * Guests own their comments through a random secret kept in their
 * browser. Only its hash is stored (and returned in listings), so the
 * secret can't be lifted from the page to edit someone else's comment.
 */
async function guestViewerId(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `guest:${hex.slice(0, 32)}`;
}

async function commenterId(request: Request, secret?: string): Promise<string | null> {
  const user = await getSessionUser(request);
  if (user) return user.sub;
  return secret ? guestViewerId(secret) : null;
}

/**
 * Comments on a share, keyed by upload id. Signed-in viewers comment as
 * themselves; anyone else can comment as a named guest, because making
 * viewers create an account to reply is the friction we're avoiding.
 * Each upload's socialEnabled switch turns comments (and likes) off.
 */
export const Route = createFileRoute("/api/comments/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        await ensureSchema();
        const upload = await getUploadById(params.id);
        const denied = await denyUnlessViewable(upload, request);
        if (denied) return denied;
        if (!upload) return json({ error: "Upload not found" }, 404);
        if (!upload.socialEnabled) {
          return json({ error: "Comments are turned off for this upload" }, 403);
        }

        const rows = await db.query.comments.findMany({
          where: eq(comments.uploadId, params.id),
          orderBy: asc(comments.createdAt),
        });
        return json({ comments: rows });
      },

      POST: async ({ params, request }) => {
        await ensureSchema();
        const upload = await getUploadById(params.id);
        const denied = await denyUnlessViewable(upload, request);
        if (denied) return denied;
        if (!upload) return json({ error: "Upload not found" }, 404);
        if (!upload.socialEnabled) {
          return json({ error: "Comments are turned off for this upload" }, 403);
        }

        const parsed = createSchema.safeParse(
          await request.json().catch(() => null),
        );
        if (!parsed.success) {
          return json({ error: "Invalid comment" }, 400);
        }
        const user = await getSessionUser(request);
        const guest = parsed.data.guest;
        if (!user && !guest) return json({ error: "Add your name to comment" }, 401);

        const [{ total }] = await db
          .select({ total: count() })
          .from(comments)
          .where(eq(comments.uploadId, params.id));
        if (total >= MAX_COMMENTS_PER_UPLOAD) {
          return json({ error: "Comment limit reached" }, 429);
        }

        const comment = {
          id: crypto.randomUUID(),
          uploadId: params.id,
          viewerId: user ? user.sub : await guestViewerId(guest!.secret),
          authorName: user ? user.name : guest!.name,
          authorAvatar: user ? user.avatar : null,
          text: parsed.data.text,
          timestamp: parsed.data.timestamp ?? null,
        };
        await db.insert(comments).values(comment);
        const stored = await db.query.comments.findFirst({
          where: eq(comments.id, comment.id),
        });
        return json({ comment: stored }, 201);
      },

      PATCH: async ({ params, request }) => {
        await ensureSchema();
        const parsed = updateSchema.safeParse(
          await request.json().catch(() => null),
        );
        if (!parsed.success) {
          return json({ error: "Invalid edit" }, 400);
        }

        const viewerId = await commenterId(request, parsed.data.guestSecret);
        if (!viewerId) return json({ error: "Sign in to comment" }, 401);

        const result = await db
          .update(comments)
          .set({ text: parsed.data.text })
          .where(
            and(
              eq(comments.id, parsed.data.commentId),
              eq(comments.uploadId, params.id),
              eq(comments.viewerId, viewerId),
            ),
          );
        if (result.meta.changes === 0) {
          return json({ error: "Comment not found" }, 404);
        }
        const stored = await db.query.comments.findFirst({
          where: eq(comments.id, parsed.data.commentId),
        });
        return json({ comment: stored });
      },

      DELETE: async ({ params, request }) => {
        await ensureSchema();
        const parsed = deleteSchema.safeParse(
          await request.json().catch(() => null),
        );
        if (!parsed.success) {
          return json({ error: "Invalid delete" }, 400);
        }

        const viewerId = await commenterId(request, parsed.data.guestSecret);
        if (!viewerId) return json({ error: "Sign in to comment" }, 401);

        const result = await db
          .delete(comments)
          .where(
            and(
              eq(comments.id, parsed.data.commentId),
              eq(comments.uploadId, params.id),
              eq(comments.viewerId, viewerId),
            ),
          );
        if (result.meta.changes === 0) {
          return json({ error: "Comment not found" }, 404);
        }
        return json({ deleted: true });
      },

      OPTIONS: () => optionsResponse(),
    },
  },
});
