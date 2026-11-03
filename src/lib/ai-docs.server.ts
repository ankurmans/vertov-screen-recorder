import type { Upload } from "@/db/schema"

// AI documents (SOPs, bug reports, meeting notes and the rest) are part of the hosted service and
// are not included in this edition. The types stay so the API can still return an empty aiDocs.

export const AI_DOC_KINDS = ["summary-doc", "sop", "bug-report", "meeting-notes", "action-items", "message", "changelog", "handoff"] as const
export type AiDocKind = (typeof AI_DOC_KINDS)[number]
export type AiDocs = Partial<Record<AiDocKind, { text: string; at: string }>>

export const isAiDocKind = (value: unknown): value is AiDocKind => AI_DOC_KINDS.includes(value as AiDocKind)

export const parseAiDocs = (raw: string | null): AiDocs => {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return typeof value === "object" && value !== null ? (value) : {}
  } catch {
    return {}
  }
}

export async function aiAllowed(_upload: Pick<Upload, "workspaceId">): Promise<boolean> {
  return false
}

export async function generateAiDoc(_upload: Upload, _kind: AiDocKind): Promise<{ text: string; at: string } | null> {
  return null
}
