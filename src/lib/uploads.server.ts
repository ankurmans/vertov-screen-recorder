import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Upload } from "@/db/schema";
import type { Transcript } from "@/lib/transcript";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { visibleTranscript } from "@/lib/cuts";
import { parseTranscript, searchText } from "@/lib/transcript";
import { isHosted } from "@/lib/workspace.server";

export const WORKER_VERSION = "1.0.0";

export interface Author {
  name: string;
  avatar: string;
}

export function getAuthor(): Author {
  const configuredName = Reflect.get(env, "AUTHOR_NAME");
  const configuredAvatar = Reflect.get(env, "AUTHOR_AVATAR");

  return {
    name:
      typeof configuredName === "string" && configuredName
        ? configuredName
        : "Anonymous",
    avatar:
      typeof configuredAvatar === "string" && configuredAvatar
        ? configuredAvatar
        : "https://api.dicebear.com/10.x/glyphs/svg?seed=Screendrop",
  };
}

interface AuthorRow {
  name: string;
  email: string;
  image: string | null;
  anon: number | null;
}

export function authorFromRow(row: AuthorRow | null): Author {
  if (!row) return getAuthor();
  // Email sign-ups have no name until they set one; the address's local part reads fine.
  const name = row.name.trim() || (row.anon ? "Someone" : row.email.split("@")[0]);
  return {
    name,
    avatar: row.image || `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(name)}`,
  };
}

/** The recording owner's name and avatar; falls back to the deployment-wide author. */
export async function getUploadAuthor(upload: Upload): Promise<Author> {
  if (!upload.ownerId) return getAuthor();
  const row = await env.DB.prepare(
    'SELECT name, email, image, "isAnonymous" AS anon FROM "user" WHERE id = ?',
  )
    .bind(upload.ownerId)
    .first<AuthorRow>();
  return authorFromRow(row);
}

export async function getUploadById(id: string): Promise<Upload | null> {
  const row = await db.query.uploads.findFirst({
    where: eq(uploads.id, id),
  });

  return row ? normalizeUpload(row) : null;
}

export function normalizeUpload(row: Upload): Upload {
  return {
    ...row,
    mediaType:
      row.mediaType ||
      (row.contentType.startsWith("video/") ? "video" : "image"),
  };
}

/** Transcript sidecar from R2, already validated; null when absent. */
export async function getTranscript(
  upload: Upload,
): Promise<Transcript | null> {
  if (!upload.transcriptKey) return null;
  const object = await env.BUCKET.get(upload.transcriptKey);
  return object ? readTranscriptObject(object) : null;
}

/** The transcript without what was trimmed or cut: for everyone but the editor. */
export async function getViewerTranscript(upload: Upload): Promise<Transcript | null> {
  return visibleTranscript(await getTranscript(upload), upload);
}

/** Rewrites the text library search and its snippets read, so removed words are not found there either. */
export async function refreshSearchText(id: string): Promise<void> {
  const upload = await getUploadById(id);
  if (!upload?.transcriptKey) return;
  const transcript = await getTranscript(upload);
  // An unreadable sidecar leaves the stored text alone rather than blanking it.
  if (!transcript) return;
  await db.update(uploads).set({ transcriptText: searchText(visibleTranscript(transcript, upload)) }).where(eq(uploads.id, id));
}

export async function readTranscriptObject(object: R2ObjectBody): Promise<Transcript | null> {
  try {
    return parseTranscript(await object.json());
  } catch {
    return null;
  }
}

let schemaApplied = false;

/**
 * Self-hosted stacks create and upgrade the legacy tables on first use. Hosted stacks get them from drizzle/
 * migrations and skip this: it cost ~16 database round trips in every new Worker isolate, on the request that hit it.
 * Only the finished state is remembered, never a pending promise, which is not safe to share between requests.
 */
export async function ensureSchema(): Promise<void> {
  if (schemaApplied || isHosted()) return;
  // Two requests can upgrade an old database at once; the loser sees "duplicate column", so it looks again.
  await applySchema().catch(() => applySchema());
  schemaApplied = true;
}

/** Runs every schema statement now; the setup endpoint calls this directly so it always reports what it changed. */
export async function applySchema(): Promise<Array<string>> {
  const applied: Array<string> = [];

  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER, height INTEGER, r2_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), media_type TEXT NOT NULL DEFAULT 'image', duration REAL)",
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at DESC)",
  );

  const columns = await env.DB.prepare("PRAGMA table_info(uploads)").all<{
    name: string;
  }>();
  const columnNames = new Set(columns.results.map((row) => row.name));

  if (!columnNames.has("media_type")) {
    await env.DB.exec(
      "ALTER TABLE uploads ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'",
    );
    applied.push("media_type");
  }

  if (!columnNames.has("duration")) {
    await env.DB.exec("ALTER TABLE uploads ADD COLUMN duration REAL");
    applied.push("duration");
  }

  const v2Columns: Array<[name: string, definition: string]> = [
    ["title", "TEXT"],
    ["poster_key", "TEXT"],
    ["transcript_key", "TEXT"],
    ["storyboard_key", "TEXT"],
    ["storyboard_meta", "TEXT"],
    ["chapters", "TEXT"],
    ["views", "INTEGER NOT NULL DEFAULT 0"],
    ["social_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["cta_clicks", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, definition] of v2Columns) {
    if (!columnNames.has(name)) {
      await env.DB.exec(`ALTER TABLE uploads ADD COLUMN ${name} ${definition}`);
      applied.push(name);
    }
  }

  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, viewer_id TEXT NOT NULL, author_name TEXT NOT NULL, author_avatar TEXT, text TEXT NOT NULL, timestamp REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_comments_upload_id ON comments(upload_id)",
  );

  const commentColumns = await env.DB.prepare(
    "PRAGMA table_info(comments)",
  ).all<{ name: string }>();
  if (!commentColumns.results.some((row) => row.name === "author_avatar")) {
    await env.DB.exec("ALTER TABLE comments ADD COLUMN author_avatar TEXT");
    applied.push("author_avatar");
  }

  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS likes (upload_id TEXT NOT NULL, viewer_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (upload_id, viewer_id))",
  );

  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS view_events (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, country TEXT, city TEXT, referrer TEXT, device TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_view_events_upload_id ON view_events(upload_id)",
  );
  const eventColumns = await env.DB.prepare("PRAGMA table_info(view_events)").all<{ name: string }>();
  if (!eventColumns.results.some((row) => row.name === "workspace_id")) {
    await env.DB.exec("ALTER TABLE view_events ADD COLUMN workspace_id TEXT");
    applied.push("workspace_id");
  }

  return applied;
}

export function isVideoContentType(contentType: string): boolean {
  return contentType.startsWith("video/");
}
