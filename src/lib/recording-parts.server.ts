import { DurableObject, env } from "cloudflare:workers"
import { MAX_RECORDING_BYTES } from "@/lib/recording-limit"
import { inRegion } from "@/lib/region.server"

type Track = "screen" | "camera"
type Part = { partNumber: number; etag: string; track: Track; size: number }

export class RecordingPartStore extends DurableObject {
  #tail = Promise.resolve()
  #pending = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS parts (
      track TEXT NOT NULL, partNumber INTEGER NOT NULL, etag TEXT NOT NULL, size INTEGER NOT NULL,
      PRIMARY KEY (track, partNumber)
    ) WITHOUT ROWID`)
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS closed (id INTEGER PRIMARY KEY)")
  }

  // Requests interleave during R2 I/O. Serialize multipart writes and completion for this recording.
  #serialize<T>(action: (waited: boolean) => Promise<T>): Promise<T> {
    const waited = this.#pending++ > 0
    const result = this.#tail.then(() => action(waited)).finally(() => { this.#pending-- })
    this.#tail = result.then(() => {}, () => {})
    return result
  }

  uploadPart(
    track: Track,
    partNumber: number,
    size: number,
    writeToR2: () => Promise<R2UploadedPart>,
    recheckAccess: () => Promise<401 | 404 | null>,
  ) {
    const enteredAt = performance.now()
    const pending = this.#serialize(async (waited) => {
      const denied = waited ? await recheckAccess() : null
      if (denied) return { outcome: "denied" as const, status: denied }
      const sql = this.ctx.storage.sql
      if (sql.exec("SELECT id FROM closed").toArray().length) return { outcome: "closed" as const }
      const { bytes, replacing } = sql.exec<{ bytes: number; replacing: number }>(
        `SELECT coalesce(sum(CASE WHEN track = ?1 AND partNumber = ?2 THEN 0 ELSE size END), 0) AS bytes,
                count(CASE WHEN track = ?1 AND partNumber = ?2 THEN 1 END) AS replacing FROM parts`,
        track, partNumber,
      ).one()
      if (bytes + size > MAX_RECORDING_BYTES) return { outcome: "too_large" as const }
      // A replacement can change the R2 ETag even if its response is lost. Remove the old
      // entry durably before attempting that write, so a completion can only use confirmed parts.
      const rowsRemoved = replacing
        ? sql.exec("DELETE FROM parts WHERE track = ? AND partNumber = ?", track, partNumber).rowsWritten
        : 0
      if (rowsRemoved) await this.ctx.storage.sync()
      const part = await writeToR2()
      const { rowsWritten } = sql.exec(
        "INSERT INTO parts (track, partNumber, etag, size) VALUES (?, ?, ?, ?)", track, partNumber, part.etag, size,
      )
      return { outcome: "saved" as const, part, rowsWritten: rowsRemoved + rowsWritten, elapsedMs: performance.now() - enteredAt }
    })
    return pending
  }

  finish(complete: (parts: Part[], waited: boolean) => Promise<Response>) {
    return this.#serialize(async (waited) => {
      const parts = this.ctx.storage.sql.exec<Part>(
        "SELECT track, partNumber, etag, size FROM parts ORDER BY track, partNumber",
      ).toArray()
      const response = await complete(parts, waited)
      if (response.ok) this.#close()
      return response
    })
  }

  remove(removeFromStorage: () => Promise<void>) {
    return this.#serialize(async () => {
      await removeFromStorage()
      this.#close()
    })
  }

  #close() {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO closed (id) VALUES (1)")
      this.ctx.storage.sql.exec("DELETE FROM parts")
    })
  }
}

function partStoreNamespace() {
  return (env as Env & { RECORDING_PART_STORE?: DurableObjectNamespace<RecordingPartStore> }).RECORDING_PART_STORE
}

export function recordingPartCoordinationAvailable() {
  return Boolean(partStoreNamespace())
}

export function recordingPartStore({ id }: { id: string; r2Key?: string | null }) {
  const namespace = partStoreNamespace()
  if (!namespace) return null
  const localNamespace = inRegion(namespace)
  return localNamespace.get(localNamespace.idFromName(id))
}

export type CoordinatedPart = Part
