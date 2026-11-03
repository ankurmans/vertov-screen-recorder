import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { hashPassword } from "@/lib/access.server";
import { json } from "@/lib/api.server";
import { audit } from "@/lib/audit.server";
import { folderFits, spaceInWorkspace } from "@/lib/library.server";
import { deleteUpload, ownedUpload, userApi } from "@/lib/recordings.server";
import { normalizeCuts } from "@/lib/cuts";
import { MAX_OVERLAYS, parseOverlays } from "@/lib/overlays";
import { parseStyle } from "@/lib/stage";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  trimStart: z.number().finite().nonnegative().nullable().optional(),
  trimEnd: z.number().finite().positive().nullable().optional(),
  ctaLabel: z.string().trim().max(40).nullable().optional(),
  ctaUrl: z.string().trim().max(2000).nullable().optional(),
  socialEnabled: z.boolean().optional(),
  password: z.string().min(4).max(200).nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  downloadsEnabled: z.boolean().optional(),
  requireEmail: z.boolean().optional(),
  searchIndexing: z.boolean().optional(),
  cuts: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(2000).optional(),
  visibility: z.enum(["link", "workspace"]).optional(),
  overlays: z.array(z.record(z.string(), z.unknown())).max(MAX_OVERLAYS).optional(),
  captionStyle: z.enum(["off", "clean", "bold", "karaoke"]).optional(),
  // Null moves the video back to its recorder's own library.
  spaceId: z.string().max(64).nullable().optional(),
  folderId: z.string().max(64).nullable().optional(),
  archived: z.boolean().optional(),
  // Keep a video the free-plan cleanup flagged, or bring back one it removed.
  keep: z.literal(true).optional(),
});

/** Owner edits: everything here is non-destructive and applied at playback. */
export const Route = createFileRoute("/api/recordings/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
          const parsed = updateSchema.safeParse(
            await request.json().catch(() => null),
          );
          if (!parsed.success) return json({ error: "Invalid changes" }, 400);
          const input = parsed.data;
          const changes: Partial<typeof uploads.$inferInsert> = {};
          if (input.title !== undefined) changes.title = input.title;
          if (input.style !== undefined) changes.style = JSON.stringify(parseStyle(input.style));
          if (input.socialEnabled !== undefined) changes.socialEnabled = input.socialEnabled;
          if (input.cuts !== undefined) {
            const cuts = normalizeCuts(input.cuts, upload.duration);
            changes.cuts = cuts.length ? JSON.stringify(cuts) : null;
          }
          if (input.downloadsEnabled !== undefined) changes.downloadsEnabled = input.downloadsEnabled;
          if (input.requireEmail !== undefined) changes.requireEmail = input.requireEmail;
          if (input.searchIndexing !== undefined) changes.searchIndexing = input.searchIndexing;
          if (input.expiresAt !== undefined) changes.expiresAt = input.expiresAt;
          if (input.password !== undefined) {
            changes.passwordHash = input.password ? await hashPassword(input.password) : null;
          }
          if (input.visibility !== undefined) changes.visibility = input.visibility;
          if (input.captionStyle !== undefined) changes.captionStyle = input.captionStyle;
          if (input.overlays !== undefined) {
            const overlays = parseOverlays(input.overlays);
            changes.overlays = overlays.length ? JSON.stringify(overlays) : null;
          }
          if (input.archived !== undefined) changes.archivedAt = input.archived ? new Date().toISOString() : null;
          if (input.keep) {
            Object.assign(changes, {
              lastViewedAt: new Date().toISOString(),
              retentionNoticeAt: null,
              retentionFinalAt: null,
              deletedAt: null,
            });
          }
          if (input.spaceId !== undefined) {
            if (input.spaceId && !(upload.workspaceId && (await spaceInWorkspace(input.spaceId, upload.workspaceId)))) {
              return json({ error: "Unknown space" }, 400);
            }
            changes.spaceId = input.spaceId;
            if (input.folderId === undefined) changes.folderId = null;
          }
          if (input.folderId !== undefined) {
            const spaceId = changes.spaceId !== undefined ? changes.spaceId : upload.spaceId;
            if (input.folderId && !(await folderFits(input.folderId, upload, spaceId ?? null))) {
              return json({ error: "Unknown folder" }, 400);
            }
            changes.folderId = input.folderId;
          }
          if (input.trimStart !== undefined) changes.trimStart = input.trimStart || null;
          if (input.trimEnd !== undefined) changes.trimEnd = input.trimEnd;
          const start = changes.trimStart !== undefined ? changes.trimStart : upload.trimStart;
          const end = changes.trimEnd !== undefined ? changes.trimEnd : upload.trimEnd;
          if (start != null && end != null && end - start < 1) {
            return json({ error: "Keep at least a second of video" }, 400);
          }
          if (input.ctaLabel !== undefined || input.ctaUrl !== undefined) {
            const label = input.ctaLabel ?? null;
            let url = input.ctaUrl ?? null;
            if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
            if (url) {
              try {
                new URL(url);
              } catch {
                return json({ error: "That button link isn't a valid URL" }, 400);
              }
            }
            changes.ctaLabel = label && url ? label : null;
            changes.ctaUrl = label && url ? url : null;
          }
          if (Object.keys(changes).length === 0) return json({ id: upload.id });
          await db.update(uploads).set(changes).where(eq(uploads.id, upload.id));
          if (upload.workspaceId) {
            const notable: Array<string> = [];
            if (input.visibility !== undefined) notable.push(`visibility ${input.visibility}`);
            if (input.password !== undefined) notable.push(input.password ? "password set" : "password removed");
            if (input.archived !== undefined) notable.push(input.archived ? "archived" : "unarchived");
            if (input.downloadsEnabled !== undefined) notable.push(input.downloadsEnabled ? "downloads on" : "downloads off");
            if (notable.length) await audit(upload.workspaceId, user.sub, "video.updated", upload.title ?? upload.id, notable.join(", "));
          }
          const { passwordHash, ...visible } = changes;
          return json({ id: upload.id, ...visible, hasPassword: passwordHash === undefined ? undefined : Boolean(passwordHash) });
        }),
      DELETE: ({ request, params }) =>
        userApi(request, async (user) => {
          const upload = await ownedUpload(params.id, user);
          if (!upload) return json({ error: "Recording not found" }, 404);
          if (upload.workspaceId) await audit(upload.workspaceId, user.sub, "video.deleted", upload.title ?? upload.id);
          await deleteUpload(upload);
          return json({ deleted: true });
        }),
    },
  },
});
