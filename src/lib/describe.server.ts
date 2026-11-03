import type { Transcript } from "@/lib/transcript";

// AI titles, summaries and chapters are part of the hosted service and are not included in this
// edition. Recordings keep their transcript and captions.

export interface Metadata {
  title?: string;
  summary?: string;
  chapters?: Array<{ title: string; start: number }>;
}

export async function describe(_transcript: Transcript, _duration: number): Promise<Metadata> {
  return {};
}
