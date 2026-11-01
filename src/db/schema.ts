import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    r2Key: text("r2_key").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    mediaType: text("media_type").notNull().default("image"),
    duration: real("duration"),
    // Human title shown on the share page; falls back to filename.
    title: text("title"),
    // R2 keys for sidecar assets uploaded after the media itself.
    posterKey: text("poster_key"),
    transcriptKey: text("transcript_key"),
    // Scrub-preview sprite sheet plus its JSON grid metadata
    // ({ tileWidth, tileHeight, columns, interval, count }).
    storyboardKey: text("storyboard_key"),
    storyboardMeta: text("storyboard_meta"),
    // Optional JSON array of { title, start } chapter markers.
    chapters: text("chapters"),
    views: integer("views").notNull().default(0),
    // Off switch for comments + likes on this upload, chosen at upload
    // time. When false, both features are hidden on the share page and
    // rejected server-side.
    socialEnabled: integer("social_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    // Better Auth user id; null for token uploads from the Screendrop app.
    ownerId: text("owner_id"),
    // "recording" while parts are still arriving, "ready" once playable.
    status: text("status").notNull().default("ready"),
    multipartUploadId: text("multipart_upload_id"),
    // Audio-only sidecar the recorder uploads for transcription.
    audioKey: text("audio_key"),
    summary: text("summary"),
    aiStatus: text("ai_status"),
    cameraKey: text("camera_key"),
    cameraContentType: text("camera_content_type"),
    cameraMultipartUploadId: text("camera_multipart_upload_id"),
    // monitor, window, browser or camera: what the main track captured.
    captureSurface: text("capture_surface"),
    // JSON StageStyle; see src/lib/stage.ts.
    style: text("style"),
    trimStart: real("trim_start"),
    trimEnd: real("trim_end"),
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    exportKey: text("export_key"),
    exportStatus: text("export_status"),
    exportSignature: text("export_signature"),
    // "pbkdf2$<salt>$<hash>"; viewers unlock with a signed cookie.
    passwordHash: text("password_hash"),
    // ISO time after which only the owner can open the link.
    expiresAt: text("expires_at"),
    // JSON [[start, end], ...] of removed source seconds, skipped at playback and in exports.
    cuts: text("cuts"),
    downloadsEnabled: integer("downloads_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    workspaceId: text("workspace_id"),
    // Null keeps the video in its owner's own library; set, every member sees it in that space.
    spaceId: text("space_id"),
    folderId: text("folder_id"),
    archivedAt: text("archived_at"),
    // "link": anyone with the link; "workspace": signed-in members only.
    visibility: text("visibility").notNull().default("link"),
    // ISO 639-1 code Whisper detected.
    language: text("language"),
    transcriptText: text("transcript_text"),
    // Last view by someone other than the owner; drives free-plan retention.
    lastViewedAt: text("last_viewed_at"),
    retentionNoticeAt: text("retention_notice_at"),
    retentionFinalAt: text("retention_final_at"),
    // Removed for inactivity: hidden and unplayable until restored or purged.
    deletedAt: text("deleted_at"),
    // Where an import came from, e.g. a Loom share URL.
    sourceUrl: text("source_url"),
    // JSON array of on-video annotations; see src/lib/overlays.ts.
    overlays: text("overlays"),
    captionStyle: text("caption_style").notNull().default("off"),
    gifKey: text("gif_key"),
    // The video request this was recorded for, if any.
    requestId: text("request_id"),
  },
  (table) => [
    index("idx_uploads_created_at").on(table.createdAt),
    index("idx_uploads_owner").on(table.ownerId, table.createdAt),
    index("idx_uploads_workspace").on(table.workspaceId, table.createdAt),
    index("idx_uploads_space").on(table.spaceId),
  ],
);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  planInterval: text("plan_interval"),
  planStatus: text("plan_status"),
  planPeriodEnd: text("plan_period_end"),
  extraBlocks: integer("extra_blocks").notNull().default(0),
  polarCustomerId: text("polar_customer_id"),
  polarSubscriptionId: text("polar_subscription_id"),
  polarExtraSubscriptionId: text("polar_extra_subscription_id"),
  planEndedAt: text("plan_ended_at"),
  defaultVisibility: text("default_visibility").notNull().default("link"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    // owner, admin or member
    role: text("role").notNull().default("member"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("idx_members_user").on(table.userId),
  ],
);

export const videoRequests = sqliteTable(
  "video_requests",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdBy: text("created_by").notNull(),
    title: text("title").notNull(),
    message: text("message"),
    spaceId: text("space_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [index("idx_requests_workspace").on(table.workspaceId)],
);

export const workspaceInvites = sqliteTable(
  "workspace_invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    role: text("role").notNull().default("member"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [index("idx_invites_workspace").on(table.workspaceId)],
);

export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_spaces_workspace").on(table.workspaceId)],
);

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    spaceId: text("space_id"),
    ownerId: text("owner_id"),
    name: text("name").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_folders_workspace").on(table.workspaceId)],
);

export const uploadParts = sqliteTable(
  "upload_parts",
  {
    uploadId: text("upload_id").notNull(),
    track: text("track").notNull().default("screen"),
    partNumber: integer("part_number").notNull(),
    etag: text("etag").notNull(),
    size: integer("size").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.uploadId, table.track, table.partNumber] }),
  ],
);

export const reactions = sqliteTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    uploadId: text("upload_id").notNull(),
    viewerId: text("viewer_id").notNull(),
    viewerName: text("viewer_name"),
    emoji: text("emoji").notNull(),
    timestamp: real("timestamp").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_reactions_upload").on(table.uploadId)],
);

export const viewProgress = sqliteTable(
  "view_progress",
  {
    uploadId: text("upload_id").notNull(),
    viewerKey: text("viewer_key").notNull(),
    viewerName: text("viewer_name"),
    viewerAvatar: text("viewer_avatar"),
    percent: real("percent").notNull().default(0),
    seconds: real("seconds").notNull().default(0),
    country: text("country"),
    city: text("city"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.uploadId, table.viewerKey] })],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    uploadId: text("upload_id").notNull(),
    // Comment ownership key. Anonymous mode: a random id minted
    // client-side and kept in localStorage. When OAuth sign-in is
    // configured: the provider identity from the session cookie
    // ("github:1234" / "google:5678"), enforced server-side.
    viewerId: text("viewer_id").notNull(),
    authorName: text("author_name").notNull(),
    // Provider avatar URL when the comment was made signed-in.
    authorAvatar: text("author_avatar"),
    text: text("text").notNull(),
    // Video time the comment is anchored to, in seconds; null for
    // general comments.
    timestamp: real("timestamp"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_comments_upload_id").on(table.uploadId)],
);

export const likes = sqliteTable(
  "likes",
  {
    uploadId: text("upload_id").notNull(),
    // Same identity model as comments.viewer_id: the OAuth subject when
    // sign-in is configured, an anonymous localStorage id otherwise.
    viewerId: text("viewer_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.uploadId, table.viewerId] })],
);

export const viewEvents = sqliteTable(
  "view_events",
  {
    id: text("id").primaryKey(),
    uploadId: text("upload_id").notNull(),
    // Viewer geo from Cloudflare's request metadata.
    country: text("country"),
    city: text("city"),
    // document.referrer of the visit; null for direct opens.
    referrer: text("referrer"),
    // Coarse device label derived from the User-Agent ("Mac", "iPhone", …).
    device: text("device"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_view_events_upload_id").on(table.uploadId)],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [index("idx_api_keys_user").on(table.userId)],
);

export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Like = typeof likes.$inferSelect;
export type ViewEvent = typeof viewEvents.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type Folder = typeof folders.$inferSelect;

/** An upload as the browser sees it; the password hash never leaves the server. */
export type PublicUpload = Omit<Upload, "passwordHash"> & { hasPassword: boolean };

export type VideoRequest = typeof videoRequests.$inferSelect;
