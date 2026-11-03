import type { Upload } from "@/db/schema"

type Indexable = Pick<Upload, "searchIndexing" | "visibility" | "expiresAt" | "requireEmail" | "mediaType" | "status" | "deletedAt" | "archivedAt"> & { hasPassword?: boolean; passwordHash?: string | null }

/** Only an opted-in, openly shared, ready video may be shown to search engines. Anything gated stays noindex. */
export function isIndexable(upload: Indexable): boolean {
  return (
    upload.searchIndexing === true &&
    upload.visibility === "link" &&
    !upload.hasPassword &&
    !upload.passwordHash &&
    !upload.expiresAt &&
    !upload.requireEmail &&
    upload.mediaType === "video" &&
    upload.status === "ready" &&
    !upload.deletedAt &&
    !upload.archivedAt
  )
}

/** ISO 8601 duration for schema.org, e.g. PT1M7S. */
export function isoDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`
}

/** D1 stores "YYYY-MM-DD HH:MM:SS" in UTC; search engines want ISO 8601. */
export function isoDate(stored: string): string {
  const value = /[zZ]|[+-]\d\d:?\d\d$/.test(stored) ? stored : `${stored.replace(" ", "T")}Z`
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? stored : date.toISOString()
}
