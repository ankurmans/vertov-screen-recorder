// AI titles, summaries and chapters are part of the hosted service and are not included in this
// edition, so there is nothing to tell the owner after an edit.

export interface AiTextNotice {
  held: boolean;
  chapters: boolean;
  restored: boolean;
  checkTitle: boolean;
}

export function useAiTextNotice(_notify: (message: string) => void) {
  return { hidden: { summary: false, chapters: false }, apply: (_notice?: AiTextNotice) => {} };
}
