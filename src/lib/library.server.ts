import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Folder, Space, Upload } from "@/db/schema";
import { db } from "@/db";
import { HOSTED_EDITION } from "@/lib/edition";
import { folders, spaces, uploads } from "@/db/schema";

export interface LibraryVideo {
  id: string;
  title: string | null;
  duration: number | null;
  views: number;
  createdAt: string;
  status: string;
  aiStatus: string | null;
  posterKey: string | null;
  ownerId: string | null;
  ownerName: string | null;
  spaceId: string | null;
  folderId: string | null;
  visibility: string;
  archivedAt: string | null;
  deletedAt: string | null;
  retentionNoticeAt: string | null;
  /** Set when someone recorded this for a video request. */
  requestId: string | null;
  /** Transcript text around a search match. */
  snippet: string | null;
}

export type LibraryView =
  | { kind: "mine"; folderId: string | null }
  | { kind: "space"; spaceId: string; folderId: string | null }
  | { kind: "archive" }
  | { kind: "later" }
  | { kind: "search"; query: string };

export type LibraryReader = Pick<typeof db, "select"> & { $client: Pick<D1DatabaseSession, "prepare"> };

export function libraryReader(): LibraryReader {
  if (!HOSTED_EDITION || Reflect.get(env, "D1_LIBRARY_READ_SESSIONS") !== "1"
      || typeof env.DB.withSession !== "function") return db;
  // Drizzle's D1 select path uses prepare(), which is shared by D1 bindings and sessions.
  return drizzle(env.DB.withSession("first-primary") as unknown as D1Database);
}

const columns = {
  id: uploads.id,
  title: uploads.title,
  duration: uploads.duration,
  views: uploads.views,
  createdAt: uploads.createdAt,
  status: uploads.status,
  aiStatus: uploads.aiStatus,
  posterKey: uploads.posterKey,
  ownerId: uploads.ownerId,
  spaceId: uploads.spaceId,
  folderId: uploads.folderId,
  visibility: uploads.visibility,
  archivedAt: uploads.archivedAt,
  deletedAt: uploads.deletedAt,
  retentionNoticeAt: uploads.retentionNoticeAt,
  requestId: uploads.requestId,
};

export function libraryScope(workspaceId: string, userId: string, view: LibraryView) {
  const inWorkspace = eq(uploads.workspaceId, workspaceId);
  const live = and(isNull(uploads.deletedAt), isNull(uploads.archivedAt));
  const inFolder = (folderId: string | null) => (folderId ? eq(uploads.folderId, folderId) : isNull(uploads.folderId));
  let where: SQL | undefined;
  let needle: string | null = null;
  switch (view.kind) {
    case "mine":
      where = and(inWorkspace, eq(uploads.ownerId, userId), isNull(uploads.spaceId), live, inFolder(view.folderId));
      break;
    case "space":
      where = and(inWorkspace, eq(uploads.spaceId, view.spaceId), live, inFolder(view.folderId));
      break;
    case "later":
      where = and(
        isNull(uploads.deletedAt),
        sql`${uploads.id} in (select upload_id from watch_later where user_id = ${userId})`,
      );
      break;
    case "archive":
      where = and(
        inWorkspace,
        eq(uploads.ownerId, userId),
        or(isNotNull(uploads.archivedAt), isNotNull(uploads.deletedAt)),
      );
      break;
    case "search": {
      needle = view.query.trim().toLowerCase().slice(0, 100);
      const like = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      where = and(
        inWorkspace,
        isNull(uploads.deletedAt),
        needle ? undefined : isNull(uploads.archivedAt),
        or(eq(uploads.ownerId, userId), isNotNull(uploads.spaceId)),
        or(
          sql`lower(coalesce(${uploads.title}, '')) like ${like} escape '\\'`,
          sql`lower(coalesce(${uploads.summary}, '')) like ${like} escape '\\'`,
          sql`lower(coalesce(${uploads.transcriptText}, '')) like ${like} escape '\\'`,
        ),
      );
      break;
    }
  }
  return { where, needle };
}

/** Videos the user can see in their workspace: their own, plus everything in its spaces. */
export async function listLibrary(
  workspaceId: string, userId: string, view: LibraryView, limit = 300, reader: LibraryReader = db,
): Promise<Array<LibraryVideo>> {
  const { where, needle } = libraryScope(workspaceId, userId, view);
  const rows = await reader.select({
    ...columns,
    // Ordinary views never return these potentially large fields.
    summary: needle ? uploads.summary : sql<null>`null`,
    transcriptText: needle ? uploads.transcriptText : sql<null>`null`,
  }).from(uploads).where(where).orderBy(desc(uploads.createdAt)).limit(Math.min(300, Math.max(1, limit)));
  const names = await ownerNames(rows.map((row) => row.ownerId), reader);
  return rows.map(({ summary, transcriptText, ...row }) => ({
    ...row,
    ownerName: row.ownerId ? (names.get(row.ownerId) ?? null) : null,
    snippet: needle ? snippetAround(transcriptText ?? summary ?? "", needle) : null,
  }));
}

/** Videos the free-plan cleanup has warned about and not yet removed. */
export function flaggedVideos(workspaceId: string, userId: string, reader: LibraryReader = db) {
  return reader
    .select({ id: uploads.id, title: uploads.title, retentionNoticeAt: uploads.retentionNoticeAt })
    .from(uploads)
    .where(
      and(
        eq(uploads.workspaceId, workspaceId),
        eq(uploads.ownerId, userId),
        isNotNull(uploads.retentionNoticeAt),
        isNull(uploads.deletedAt),
      ),
    )
    .orderBy(asc(uploads.retentionNoticeAt));
}

function snippetAround(text: string, needle: string): string | null {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + needle.length + 80);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

async function ownerNames(ids: Array<string | null>, reader: LibraryReader): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { results, meta } = await reader.$client.prepare(
    `SELECT id, name, email, "isAnonymous" AS anon FROM "user" WHERE id IN (${unique.map(() => "?").join(",")})`,
  )
    .bind(...unique)
    .all<{ id: string; name: string; email: string; anon: number | null }>();
  if (reader !== db && typeof meta.served_by_primary === "boolean") {
    console.log(JSON.stringify({
      message: "Library D1 session read",
      servedByPrimary: meta.served_by_primary,
      servedByRegion: meta.served_by_region,
    }));
  }
  return new Map(results.map((row) => [row.id, row.name.trim() || (row.anon ? "Someone" : row.email.split("@")[0])]));
}

export function listSpaces(workspaceId: string, reader: LibraryReader = db): Promise<Array<Space>> {
  return reader.select().from(spaces).where(eq(spaces.workspaceId, workspaceId)).orderBy(asc(spaces.name));
}

/** Folders in the user's own library and in every space of the workspace. */
export function listFolders(workspaceId: string, userId: string, reader: LibraryReader = db): Promise<Array<Folder>> {
  return reader
    .select()
    .from(folders)
    .where(and(eq(folders.workspaceId, workspaceId), or(eq(folders.ownerId, userId), isNotNull(folders.spaceId))))
    .orderBy(asc(folders.name));
}

export async function spaceInWorkspace(spaceId: string, workspaceId: string): Promise<boolean> {
  const row = await db.query.spaces.findFirst({ where: and(eq(spaces.id, spaceId), eq(spaces.workspaceId, workspaceId)) });
  return Boolean(row);
}

/** A folder can hold the video when it sits in the same place: the same space, or the recorder's own library. */
export async function folderFits(folderId: string, upload: Upload, spaceId: string | null): Promise<boolean> {
  const folder = await db.query.folders.findFirst({ where: eq(folders.id, folderId) });
  if (!folder || folder.workspaceId !== upload.workspaceId) return false;
  return spaceId ? folder.spaceId === spaceId : !folder.spaceId && folder.ownerId === upload.ownerId;
}
