import { eq } from "drizzle-orm"
import { db } from "@/db"
import { uploads, workspaces } from "@/db/schema"
import type { Upload } from "@/db/schema"
import { complete } from "@/lib/ai.server"
import { getTranscript } from "@/lib/uploads.server"
import { aiEnabled } from "@/lib/workspace.server"

export const AI_DOC_KINDS = ["summary-doc", "sop", "bug-report", "meeting-notes", "action-items", "message"] as const
export type AiDocKind = (typeof AI_DOC_KINDS)[number]
export type AiDocs = Partial<Record<AiDocKind, { text: string; at: string }>>

export const isAiDocKind = (value: unknown): value is AiDocKind => AI_DOC_KINDS.includes(value as AiDocKind)

const MAX_TRANSCRIPT_CHARS = 24_000

const BRIEFS: Record<AiDocKind, string> = {
  "summary-doc":
    "Write a short document from this recording: a title line, a 2-3 sentence overview, then sections with headings for each topic covered, with the key details under each.",
  sop:
    "Write a standard operating procedure from this recording: a title, a one-line purpose, any prerequisites, then a numbered list of steps in the order they were shown, each step one clear action, and a short list of things to watch out for if the speaker mentioned any.",
  "bug-report":
    "Write a bug report from this recording with these headings: Summary, Steps to reproduce (numbered), Expected result, Actual result, and Notes. Only state what the speaker said or showed; write 'Not stated' where something is missing.",
  "meeting-notes":
    "Write meeting notes from this recording: a title, a short summary, Key points as bullets, Decisions as bullets, and Action items as bullets with the owner in brackets when named.",
  "action-items":
    "List the action items from this recording as a Markdown checklist (- [ ] item), each starting with a verb, with the owner in brackets when one was named and the time they were said as (m:ss). If there are none, say so in one line.",
  message:
    "Write a short message the speaker could send with the link to this recording. First line: 'Subject: ' followed by a specific subject under 70 characters. Then a blank line and a 2-4 sentence friendly body saying what the video covers and what you want the reader to do. Do not include the link.",
}

/** The model is asked for JSON so it works on both providers; this pulls the text out of it. */
function parseText(raw: string): string {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const value = (JSON.parse(match[0]) as { text?: unknown }).text
      if (typeof value === "string" && value.trim()) return value.trim()
    } catch {
      // Fall back to the raw reply.
    }
  }
  return cleaned.replace(/^```(?:json|markdown)?\s*|\s*```$/g, "").trim()
}

export const parseAiDocs = (raw: string | null): AiDocs => {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return typeof value === "object" && value !== null ? (value as AiDocs) : {}
  } catch {
    return {}
  }
}

/** Whether this video's workspace may use AI documents (paid plans on the hosted service, everyone when self-hosted). */
export async function aiAllowed(upload: Pick<Upload, "workspaceId">): Promise<boolean> {
  const workspace = upload.workspaceId
    ? ((await db.query.workspaces.findFirst({ where: eq(workspaces.id, upload.workspaceId) })) ?? null)
    : null
  return aiEnabled(workspace)
}

/** Writes the document from the transcript, stores it on the video and returns it. Null when there is no transcript. */
export async function generateAiDoc(upload: Upload, kind: AiDocKind): Promise<{ text: string; at: string } | null> {
  const transcript = await getTranscript(upload)
  if (!transcript?.cues.length) return null
  const lines = transcript.cues
    .map((cue) => `[${Math.floor(cue.start / 60)}:${String(Math.floor(cue.start % 60)).padStart(2, "0")}] ${cue.text}`)
    .join("\n")
    .slice(0, MAX_TRANSCRIPT_CHARS)
  const raw = await complete(
    "You turn transcripts of screen recordings into clear written documents. Write only from what is in the transcript and invent nothing. Write in the same language as the transcript. Reply with JSON only: {\"text\": \"<the document in Markdown>\"}.",
    `${BRIEFS[kind]}\n\nVideo title: ${upload.title ?? "Untitled"}\n\nTranscript:\n${lines}`,
    2000,
  )
  const text = parseText(raw)
  if (!text) return null
  const doc = { text: text.slice(0, 12_000), at: new Date().toISOString() }
  const latest = await db.query.uploads.findFirst({ where: eq(uploads.id, upload.id) })
  const docs = { ...parseAiDocs(latest?.aiDocs ?? null), [kind]: doc }
  await db.update(uploads).set({ aiDocs: JSON.stringify(docs) }).where(eq(uploads.id, upload.id))
  return doc
}
