import type { AiTextNotice } from "@/components/ai-text-notice";
import type { Edits } from "@/lib/cuts";

// AI titles, summaries and chapters are part of the hosted service and are not included in this
// edition, so edits have no AI text to keep in step with.

export const aiTextRecord = (_seen: Edits, _title: string | null): string | null => null;

export async function syncAiText(_id: string): Promise<AiTextNotice> {
  return { held: false, chapters: false, restored: false, checkTitle: false };
}

export async function rewriteAiText(_id: string, _token: string, _attempt?: number): Promise<void> {}
