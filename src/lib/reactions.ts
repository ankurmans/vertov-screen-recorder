/** Reactions anyone can leave on a moment of a video. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "🔥", "👀", "🙌"] as const

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

/** Random per-browser id for anonymous viewers (reactions, watch progress). */
export function anonymousViewerId(): string {
  try {
    let id = localStorage.getItem("reelay_viewer")
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem("reelay_viewer", id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

/** Private per-browser secret that lets a guest edit their own comments. */
export function guestSecret(): string {
  try {
    let secret = localStorage.getItem("reelay_guest_secret")
    if (!secret) {
      secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "")
      localStorage.setItem("reelay_guest_secret", secret)
    }
    return secret
  } catch {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "")
  }
}

/** Mirrors the server's guestViewerId so the page knows which comments are ours. */
export async function guestViewerId(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `guest:${hex.slice(0, 32)}`
}

export function savedGuestName(): string {
  try {
    return localStorage.getItem("reelay_name") ?? ""
  } catch {
    return ""
  }
}

export function saveGuestName(name: string) {
  try {
    localStorage.setItem("reelay_name", name)
  } catch {
    // Private mode: they'll type it again next time.
  }
}
