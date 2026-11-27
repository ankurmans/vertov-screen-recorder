import type { Transcript } from "@/lib/transcript";
import type { Workspace } from "@/db/schema";

// AI titles, summaries and chapters are part of the hosted service and are not included in this
// edition. Recordings keep their transcript and captions.

export interface Metadata {
  title?: string;
  summary?: string;
  chapters?: Array<{ title: string; start: number }>;
}

export async function describe(_transcript: Transcript, _duration: number, _workspace: Pick<Workspace, "plan"> | null, _language: string | null, _signal?: AbortSignal): Promise<Metadata> {
  return {};
}
