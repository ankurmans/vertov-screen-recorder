import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { playlistItems, playlists, uploads } from "@/db/schema"
import type { Playlist, Upload } from "@/db/schema"
import type { SessionUser } from "@/lib/auth.server"
import { accessFor } from "@/lib/access.server"
import { canManage } from "@/lib/plans"
import type { Role } from "@/lib/plans"
import { roleIn } from "@/lib/workspace.server"

export const MAX_PLAYLIST_ITEMS = 200

export interface PlaylistSummary {
  id: string
  title: string
  description: string | null
  visibility: "link" | "workspace"
  ownerId: string
  count: number
  createdAt: string
}

export interface PlaylistVideo {
  id: string
  title: string
  duration: number | null
  hasPoster: boolean
  /** False when the video has its own gate (members-only, password, email, expiry); it opens on its own page. */
  playable: boolean
}

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12)
const visibilityOf = (value: string): "link" | "workspace" => (value === "workspace" ? "workspace" : "link")

const summary = (row: Playlist, count: number): PlaylistSummary => ({
  id: row.id,
  title: row.title,
  description: row.description,
  visibility: visibilityOf(row.visibility),
  ownerId: row.ownerId,
  count,
  createdAt: row.createdAt,
})

export async function listPlaylists(workspaceId: string): Promise<Array<PlaylistSummary>> {
  const rows = await db.select().from(playlists).where(eq(playlists.workspaceId, workspaceId)).orderBy(desc(playlists.createdAt))
  if (!rows.length) return []
  const counts = await db
    .select({ id: playlistItems.playlistId, count: sql<number>`count(*)` })
    .from(playlistItems)
    .where(inArray(playlistItems.playlistId, rows.map((row) => row.id)))
    .groupBy(playlistItems.playlistId)
  const byId = new Map(counts.map((row) => [row.id, Number(row.count)]))
  return rows.map((row) => summary(row, byId.get(row.id) ?? 0))
}

export async function createPlaylist(workspaceId: string, ownerId: string, input: { title: string; description?: string | null }): Promise<PlaylistSummary> {
  const row: Playlist = {
    id: newId(),
    workspaceId,
    ownerId,
    title: input.title,
    description: input.description ?? null,
    visibility: "link",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await db.insert(playlists).values(row)
  return summary(row, 0)
}

/** A playlist in this workspace, or null. */
export async function workspacePlaylist(id: string, workspaceId: string): Promise<Playlist | null> {
  return (await db.query.playlists.findFirst({ where: and(eq(playlists.id, id), eq(playlists.workspaceId, workspaceId)) })) ?? null
}

export const canEditPlaylist = (playlist: Playlist, user: SessionUser, role: Role) => playlist.ownerId === user.sub || canManage(role)

export async function updatePlaylist(id: string, changes: { title?: string; description?: string | null; visibility?: "link" | "workspace"; order?: Array<string> }) {
  const set: Partial<Playlist> = { updatedAt: new Date().toISOString() }
  if (changes.title !== undefined) set.title = changes.title
  if (changes.description !== undefined) set.description = changes.description
  if (changes.visibility !== undefined) set.visibility = changes.visibility
  await db.update(playlists).set(set).where(eq(playlists.id, id))
  if (changes.order) {
    const current = new Set((await db.select({ id: playlistItems.uploadId }).from(playlistItems).where(eq(playlistItems.playlistId, id))).map((row) => row.id))
    const ordered = changes.order.filter((uploadId) => current.has(uploadId))
    await db.batch(
      ordered.map((uploadId, position) => db.update(playlistItems).set({ position }).where(and(eq(playlistItems.playlistId, id), eq(playlistItems.uploadId, uploadId)))) as never,
    )
  }
}

export async function deletePlaylist(id: string) {
  await db.batch([db.delete(playlistItems).where(eq(playlistItems.playlistId, id)), db.delete(playlists).where(eq(playlists.id, id))])
}

/** Adds a workspace video the user can already see in the library. Returns an error message or null. */
export async function addToPlaylist(playlist: Playlist, uploadId: string, user: SessionUser, role: Role): Promise<string | null> {
  const upload = await db.query.uploads.findFirst({ where: and(eq(uploads.id, uploadId), eq(uploads.workspaceId, playlist.workspaceId), isNull(uploads.deletedAt)) })
  if (!upload || upload.mediaType !== "video") return "Video not found"
  if (upload.ownerId !== user.sub && !upload.spaceId && !canManage(role)) return "Only videos you recorded or ones shared in a space can be added"
  const [{ count, top }] = await db
    .select({ count: sql<number>`count(*)`, top: sql<number | null>`max(${playlistItems.position})` })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlist.id))
  if (Number(count) >= MAX_PLAYLIST_ITEMS) return `A playlist holds up to ${MAX_PLAYLIST_ITEMS} videos`
  await db
    .insert(playlistItems)
    .values({ playlistId: playlist.id, uploadId, position: (top ?? -1) + 1, addedAt: new Date().toISOString() })
    .onConflictDoNothing()
  return null
}

export async function removeFromPlaylist(playlistId: string, uploadId: string) {
  await db.delete(playlistItems).where(and(eq(playlistItems.playlistId, playlistId), eq(playlistItems.uploadId, uploadId)))
}

async function itemsOf(playlistId: string): Promise<Array<Upload>> {
  const rows = await db
    .select({ upload: uploads })
    .from(playlistItems)
    .innerJoin(uploads, eq(uploads.id, playlistItems.uploadId))
    .where(and(eq(playlistItems.playlistId, playlistId), isNull(uploads.deletedAt)))
    .orderBy(asc(playlistItems.position), asc(playlistItems.addedAt))
  return rows.map((row) => row.upload)
}

export async function playlistVideos(playlistId: string, request: Request): Promise<Array<PlaylistVideo>> {
  const items = await itemsOf(playlistId)
  return Promise.all(
    items.map(async (upload) => ({
      id: upload.id,
      title: upload.title?.trim() || "Untitled video",
      duration: upload.duration,
      hasPoster: Boolean(upload.posterKey),
      playable: (await accessFor(upload, request)) === "open",
    })),
  )
}

/** The public view: null when it doesn't exist or the viewer may not see it. */
export async function viewPlaylist(id: string, request: Request, user: SessionUser | null) {
  const playlist = await db.query.playlists.findFirst({ where: eq(playlists.id, id) })
  if (!playlist) return null
  if (playlist.visibility === "workspace" && !(user && (await roleIn(playlist.workspaceId, user.sub)))) return null
  return { playlist: summary(playlist, 0), videos: await playlistVideos(playlist.id, request) }
}
