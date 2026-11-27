import { LESSONS } from "./lifecycle-emails";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export type Facts = { ready: number; transcribed: number; viewed: number; edited: number; customized: number; imported: number; protected: number };
export type Milestone = { event: string; first_at: number; last_at: number };
export type SendClaim = { lesson: string; claimed_at: number };

/** Recomputed from current product state, never a queued calendar sequence. Stable lesson IDs preserve all old claims. */
export function selectLifecycleLesson(created: number, facts: Facts, events: Milestone[], sent: SendClaim[], now: number) {
  const validEvents = events.filter(e => Number.isFinite(e.first_at) && Number.isFinite(e.last_at) && e.first_at >= created && e.first_at <= now && e.last_at >= e.first_at && e.last_at <= now);
  const event = (name: string) => validEvents.find(e => e.event === name);
  const first = (name: string) => event(name)?.first_at;
  const lastActive = Math.max(created, ...validEvents.filter(e => e.event !== "viewed").map(e => e.last_at));
  const active = now - lastActive < 7 * DAY;
  const inWindow = (at: number | undefined, delay: number, expires = 7 * DAY) =>
    at !== undefined && at <= now && now >= at + delay && now < at + delay + expires;
  const candidates: Array<[string, boolean]> = [
    // A useful first action; no welcome if they have already progressed before the scheduler sees them.
    ["welcome", facts.ready === 0 && inWindow(created, 0, DAY)],
    ["first-recording", facts.ready === 0 && inWindow(created, 3 * DAY, 4 * DAY)],
    // These clocks start on real completed actions, not signup birthdays.
    ["import-review", facts.imported > 0 && facts.viewed === 0 && active && inWindow(first("imported"), 2 * HOUR)],
    ["first-view", facts.ready > 0 && facts.viewed === 0 && first("shared") === undefined && active && inWindow(first("recorded"), 2 * HOUR)],
    ["help", facts.ready > 0 && facts.viewed === 0 && active && (inWindow(first("shared"), 3 * DAY, 4 * DAY) || inWindow(first("recorded"), 7 * DAY, 3 * DAY))],
    // One return/help message, then silence unless they come back.
    ["come-back", facts.ready > 0 && inWindow(lastActive, 7 * DAY, 14 * DAY)],
    ["edit", facts.viewed > 0 && facts.transcribed > 0 && facts.edited === 0 && active && inWindow(first("viewed"), 2 * HOUR)],
    ["layout", facts.viewed > 0 && facts.customized === 0 && active && inWindow(first("viewed"), 2 * DAY)],
    ["privacy", facts.viewed > 0 && facts.protected === 0 && active && inWindow(first("viewed"), 4 * DAY)],
    ["loom-import", facts.viewed > 0 && facts.ready - facts.imported >= 2 && facts.imported === 0 && active && inWindow(first("recorded"), 2 * HOUR, 21 * DAY)],
    ["thank-you", facts.ready >= 2 && facts.viewed > 0 && active && inWindow(first("viewed"), 7 * DAY, 14 * DAY)],
    ["mastery", facts.ready - facts.imported >= 3 && facts.viewed > 0 && active && inWindow(first("recorded"), 7 * DAY, 21 * DAY)],
  ];
  const match = candidates.find(([id, relevant]) => relevant && !sent.some(s => s.lesson === id));
  return match ? LESSONS.find(l => l.id === match[0]) : undefined;
}
