import { and, desc, eq, isNotNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Transcription } from "@/lib/ai.server";
import type { Transcript, TranscriptWord } from "@/lib/transcript";
import { db } from "@/db";
import { uploads, workspaces } from "@/db/schema";
import { complete, transcribe } from "@/lib/ai.server";
import { parseTranscript } from "@/lib/transcript";
import { getUploadById } from "@/lib/uploads.server";
import { aiEnabled } from "@/lib/workspace.server";

const MAX_TRANSCRIPT_CHARS = 24_000;
// A punctuated prompt nudges Whisper into sentence case and punctuation, and its fillers stop
// Whisper silently dropping the user's "um"s, which the editor cuts. English audio only.
const ENGLISH_PROMPT = "Hi there. Um, so, uh, in this video I'll walk you through it.";

interface Metadata {
  title?: string;
  summary?: string;
  chapters?: Array<{ title: string; start: number }>;
}

/**
 * Queue job after a recording finishes: Whisper transcript from the
 * audio sidecar, then an AI title, summary and chapters when the
 * workspace's plan includes them. Each step saves as it lands, so the
 * share page fills in progressively.
 */
export async function processRecording(id: string): Promise<void> {
  const upload = await getUploadById(id);
  if (!upload || !upload.audioKey) return;

  try {
    const audio = await env.BUCKET.get(upload.audioKey);
    if (!audio) throw new Error("audio sidecar missing");
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const contentType = audio.httpMetadata?.contentType ?? upload.contentType;

    const spoken = await transcribeInLanguage(bytes, contentType, await languageHint(upload.ownerId));
    const transcript = toTranscript(spoken);

    if (!transcript) {
      // Silent recording: nothing to title from.
      await db.update(uploads).set({ aiStatus: "done" }).where(eq(uploads.id, id));
      return;
    }

    const transcriptKey = `uploads/${id}/transcript.json`;
    await env.BUCKET.put(transcriptKey, JSON.stringify(transcript), {
      httpMetadata: { contentType: "application/json" },
    });
    await db
      .update(uploads)
      .set({
        transcriptKey,
        language: spoken.language,
        // Files from agents and URLs arrive without a length; Whisper knows it.
        ...(upload.duration == null && spoken.duration ? { duration: spoken.duration } : {}),
        transcriptText: transcript.cues.map((cue) => cue.text).join(" ").slice(0, 100_000),
      })
      .where(eq(uploads.id, id));

    const workspace = upload.workspaceId
      ? ((await db.query.workspaces.findFirst({ where: eq(workspaces.id, upload.workspaceId) })) ?? null)
      : null;
    if (!aiEnabled(workspace)) {
      await db.update(uploads).set({ aiStatus: "done" }).where(eq(uploads.id, id));
      return;
    }

    const metadata = await describe(transcript, upload.duration ?? spoken.duration ?? 0);
    const latest = await getUploadById(id);
    await db
      .update(uploads)
      .set({
        // Never overwrite a title the owner typed while this ran.
        title: latest?.title || metadata.title?.slice(0, 120) || null,
        summary: metadata.summary?.slice(0, 2000) || null,
        chapters: metadata.chapters?.length ? JSON.stringify(metadata.chapters) : null,
        aiStatus: "done",
      })
      .where(eq(uploads.id, id));
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Processing failed",
        id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await db.update(uploads).set({ aiStatus: "failed" }).where(eq(uploads.id, id));
  }
}

/** The language of the owner's last transcript: most people record in one language. */
async function languageHint(ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  const row = await db
    .select({ language: uploads.language })
    .from(uploads)
    .where(and(eq(uploads.ownerId, ownerId), isNotNull(uploads.language)))
    .orderBy(desc(uploads.createdAt))
    .limit(1);
  return row[0]?.language ?? null;
}

/**
 * English gets the filler-keeping prompt; any other language is transcribed with its own code and
 * no English prompt, which would otherwise pull the transcript toward English. When the guess was
 * English and Whisper hears something else, the second pass redoes it in that language.
 */
export async function transcribeInLanguage(
  audio: Uint8Array,
  contentType: string,
  hint: string | null,
): Promise<Transcription> {
  if (hint && hint !== "en") {
    const result = await transcribe(audio, contentType, { language: hint });
    return { ...result, language: result.language ?? hint };
  }
  const first = await transcribe(audio, contentType, { prompt: ENGLISH_PROMPT });
  if (!first.language || first.language === "en") return { ...first, language: first.language ?? "en" };
  return transcribe(audio, contentType, { language: first.language }).then((second) => ({
    ...second,
    language: second.language ?? first.language,
  }));
}

export function toTranscript(output: Transcription): Transcript | null {
  const words: Array<TranscriptWord> = [];
  for (const word of output.words) {
    const text = word.word.trim();
    if (text) words.push({ text, start: word.start, end: word.end });
  }
  return parseTranscript({
    // Whisper turns noise and beeps into "." or "…"; keep only cues with actual words.
    cues: output.segments.filter((segment) => /[\p{L}\p{N}]/u.test(segment.text)).map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text.trim(),
    })),
    words,
  });
}

export async function describe(transcript: Transcript, duration: number): Promise<Metadata> {
  const lines = transcript.cues
    .map((cue) => `[${Math.floor(cue.start)}s] ${cue.text}`)
    .join("\n")
    .slice(0, MAX_TRANSCRIPT_CHARS);
  const wantChapters = duration >= 120;

  const raw = await complete(
    "You write metadata for screen recordings people share with coworkers. Reply with JSON only, no prose. Write every field in the same language as the transcript.",
    `Transcript with start times in seconds:\n${lines}\n\nReturn JSON: {"title": a specific 3-8 word title in sentence case (capitalize only the first word and proper nouns, like "Walkthrough of the new pricing page") with no quotes or trailing period, "summary": 1-3 plain sentences on what the video covers${
      wantChapters
        ? ', "chapters": 3-8 items {"title": 2-5 words, "start": seconds}, the first starting at 0'
        : ""
    }}`,
    1500,
  );
  return parseMetadata(raw, duration);
}

function parseMetadata(raw: string, duration: number): Metadata {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const chapters = Array.isArray(parsed.chapters)
      ? parsed.chapters
          .filter(
            (chapter): chapter is { title: string; start: number } =>
              typeof chapter === "object" &&
              chapter !== null &&
              typeof chapter.title === "string" &&
              Number.isFinite(chapter.start) &&
              chapter.start >= 0 &&
              (!duration || chapter.start < duration),
          )
          .map((chapter) => ({ title: chapter.title.slice(0, 80), start: chapter.start }))
          .sort((a, b) => a.start - b.start)
      : undefined;
    return {
      title: typeof parsed.title === "string" ? parsed.title.trim().replace(/^"|"$/g, "") : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : undefined,
      chapters,
    };
  } catch {
    return {};
  }
}
