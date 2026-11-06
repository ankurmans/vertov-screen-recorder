import { queuePoster } from "@/lib/poster.server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Transcription } from "@/lib/ai.server";
import type { Transcript, TranscriptWord } from "@/lib/transcript";
import { db } from "@/db";
import { uploads, workspaces } from "@/db/schema";
import { transcribe } from "@/lib/ai.server";
import { describe } from "@/lib/describe.server";
import { parseTranscript } from "@/lib/transcript";
import { getUploadById } from "@/lib/uploads.server";
import { aiEnabled } from "@/lib/workspace.server";

// A punctuated prompt nudges Whisper into sentence case and punctuation, and its fillers stop
// Whisper silently dropping the user's "um"s, which the editor cuts. English audio only.
const ENGLISH_PROMPT = "Hi there. Um, so, uh, in this video I'll walk you through it.";

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

    const spoken = dropSilenceHallucinations(
      await transcribeInLanguage(bytes, contentType, await languageHint(upload.ownerId)),
      upload.duration,
    );
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
    // The AI title usually lands after the first cover was made from the bare filename.
    if (!latest?.title && metadata.title) await queuePoster(id, 2, "refresh");
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

// What Whisper writes when it hears silence: phrases from the subtitled videos it learned on.
const SILENCE_PHRASES = new Set([
  "thank you", "thank you very much", "thank you so much", "thanks", "thanks for watching", "thank you for watching",
  "you", "bye", "bye bye", "please subscribe", "subscribe", "subtitles by the amaraorg community",
]);
const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Whisper invents a line ("Thank you.") for silent audio, and its confidence scores don't flag it (no_speech_prob
 * comes back 0). Its timing does: the line runs past the end of the audio, or a single word lasts seconds. Real
 * speech can't do either, so those segments go.
 */
export function dropSilenceHallucinations(output: Transcription, audioSeconds: number | null): Transcription {
  const length = audioSeconds ?? output.duration;
  const invented = (segment: Transcription["segments"][number]) => {
    if (length && segment.start >= length - 0.05) return true;
    if (!SILENCE_PHRASES.has(normalise(segment.text))) return false;
    if (length && segment.end > length + 0.5) return true;
    return output.words.some((word) => word.start >= segment.start && word.end <= segment.end + 0.01 && word.end - word.start > 2.5);
  };
  const dropped = output.segments.filter(invented);
  if (dropped.length === 0) return output;
  const inDropped = (time: number) => dropped.some((segment) => time >= segment.start && time <= segment.end);
  return {
    ...output,
    segments: output.segments.filter((segment) => !dropped.includes(segment)),
    words: output.words.filter((word) => !inDropped(word.start)),
  };
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
