/** Rules for "Request a video" links that both the server and the browser read. */

/** The `expiresAt` of a link its creator chose to keep open. It never expires, but takes at most KEPT_OPEN_LIMIT videos. */
export const KEPT_OPEN_UNTIL = "9999-12-31T00:00:00.000Z"
export const KEPT_OPEN_LIMIT = 50

export const isKeptOpen = (expiresAt: string) => expiresAt === KEPT_OPEN_UNTIL

/**
 * A "reply by showing" link is a request link tied to one video: `reply_<uploadId>_<random>`. The random part keeps it
 * from being guessed from the share link, and the shared prefix finds a video's links by primary key.
 */
export const replyIdRange = (uploadId: string) => [`reply_${uploadId}_`, `reply_${uploadId}\``] as const
export const replyUploadId = (requestId: string) => /^reply_([a-f0-9]{8})_/.exec(requestId)?.[1] ?? null

/** A Markdown link for a bug template or help page. Brackets are dropped from the label so it cannot break the link. */
export const requestMarkdown = (label: string, url: string) => `[${label.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim()}](${url})`

/**
 * The `done` flag of `/request/:id`. The router validates its own output again when it writes the address, so `true`
 * must stay `true`: dropping it redirected people who had just sent a video back to the record form.
 */
export const parseDone = (value: unknown): true | undefined => (value === true || value === 1 || value === "1" ? true : undefined)

/** The offer on a request link's "sent" screen. */
export interface RequestInviteData {
  guest: boolean
  minutes: number
  /** Hours each side gets from a pending referral, or null when none can be promised. */
  rewardHours: number | null
}
