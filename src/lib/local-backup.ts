/**
 * Every recorded chunk is also kept in this browser (IndexedDB) until the
 * server confirms the video. If the tab crashes, the network dies or the
 * upload fails, the take is still here and can be uploaded again or
 * downloaded. Nothing you record is lost to a bad connection.
 */

export type BackupTrack = "screen" | "camera" | "audio"

export interface BackupTake {
  id: string
  startedAt: number
  mimeType: string
  cameraMimeType: string | null
  surface: string | null
  width: number | null
  height: number | null
  seconds: number
}

const DB_NAME = "reelay-backup"
const TAKES = "takes"
const CHUNKS = "chunks"

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore(TAKES, { keyPath: "id" })
      const chunks = db.createObjectStore(CHUNKS, { autoIncrement: true })
      chunks.createIndex("take", "take")
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      opening = null
      reject(request.error ?? new Error("IndexedDB unavailable"))
    }
  })
  return opening
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("Backup write failed"))
    transaction.onabort = () => reject(transaction.error ?? new Error("Backup write aborted"))
  })
}

/** Writes never block or break recording; a failed backup is only a lost safety net. */
async function quietly(work: () => Promise<void>) {
  try {
    await work()
  } catch (error) {
    console.warn("Local backup unavailable", error)
  }
}

export function startBackup(take: Omit<BackupTake, "seconds">) {
  void quietly(async () => {
    const db = await open()
    const transaction = db.transaction(TAKES, "readwrite")
    transaction.objectStore(TAKES).put({ ...take, seconds: 0 })
    await done(transaction)
  })
}

export function backupChunk(id: string, track: BackupTrack, blob: Blob) {
  if (blob.size === 0) return
  void quietly(async () => {
    const db = await open()
    const transaction = db.transaction([CHUNKS, TAKES], "readwrite")
    transaction.objectStore(CHUNKS).add({ take: id, track, blob })
    if (track === "screen") {
      // One chunk per second (MediaRecorder timeslice), so this tracks the length.
      const takes = transaction.objectStore(TAKES)
      const request = takes.get(id)
      request.onsuccess = () => {
        const take = request.result as BackupTake | undefined
        if (take) takes.put({ ...take, seconds: take.seconds + 1 })
      }
    }
    await done(transaction)
  })
}

export async function removeBackup(id: string): Promise<void> {
  await quietly(async () => {
    const db = await open()
    const transaction = db.transaction([CHUNKS, TAKES], "readwrite")
    transaction.objectStore(TAKES).delete(id)
    const cursor = transaction.objectStore(CHUNKS).index("take").openKeyCursor(IDBKeyRange.only(id))
    cursor.onsuccess = () => {
      const current = cursor.result
      if (!current) return
      transaction.objectStore(CHUNKS).delete(current.primaryKey)
      current.continue()
    }
    await done(transaction)
  })
}

export async function unfinishedTakes(): Promise<Array<BackupTake>> {
  try {
    const db = await open()
    const transaction = db.transaction(TAKES, "readonly")
    const request = transaction.objectStore(TAKES).getAll()
    await done(transaction)
    return (request.result as Array<BackupTake>).filter((take) => take.seconds > 0).sort((a, b) => b.startedAt - a.startedAt)
  } catch {
    return []
  }
}

/** The take's tracks reassembled into playable files. */
export async function readTake(id: string): Promise<Record<BackupTrack, Blob | null>> {
  const db = await open()
  const transaction = db.transaction(CHUNKS, "readonly")
  const request = transaction.objectStore(CHUNKS).index("take").getAll(IDBKeyRange.only(id))
  await done(transaction)
  const rows = request.result as Array<{ track: BackupTrack; blob: Blob }>
  const join = (track: BackupTrack) => {
    const parts = rows.filter((row) => row.track === track).map((row) => row.blob)
    return parts.length ? new Blob(parts, { type: parts[0].type }) : null
  }
  return { screen: join("screen"), camera: join("camera"), audio: join("audio") }
}
