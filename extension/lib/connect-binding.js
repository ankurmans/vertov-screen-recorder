// Ties the key the connect page hands over to the Connect click that asked for it. The popup stores a random
// state and the server it chose (chrome.storage.session, short TTL); connect.html stores the key only when
// the fragment carries that state and that server, and the entry is used up either way.

export const PENDING_KEY = "pendingConnect"
export const PENDING_TTL_MS = 5 * 60_000
const TOKEN = /^rk_[a-f0-9]{40}$/
const STATE = /^[a-f0-9]{32}$/

/** 128 random bits as 32 hex characters. */
export function newState(random = (bytes) => crypto.getRandomValues(bytes)) {
  return [...random(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Called by the popup's Connect button: remember the request and return the state to put in the URL. */
export async function startConnect(session, server, now = Date.now(), state = newState()) {
  await session.set({ [PENDING_KEY]: { state, server: new URL(server).origin, at: now } })
  return state
}

/** The URL Connect opens on the server. */
export function connectUrl(server, extensionId, state) {
  return `${new URL(server).origin}/connect-extension?ext=${extensionId}&state=${state}`
}

/**
 * Called by connect.html with the fragment's values. Returns what to store, or null when there is no matching,
 * unexpired connect request. The pending request is removed before anything else, so a state works once.
 */
export async function acceptHandoff(session, { server, token, workspace, state }, now = Date.now()) {
  const { [PENDING_KEY]: pending } = await session.get(PENDING_KEY)
  await session.remove(PENDING_KEY)
  if (!pending || typeof pending.state !== "string" || !STATE.test(pending.state)) return null
  if (!(now - pending.at >= 0 && now - pending.at < PENDING_TTL_MS)) return null
  if (state !== pending.state) return null
  let origin
  try {
    origin = new URL(server).origin
  } catch {
    return null
  }
  if (origin !== pending.server) return null
  if (typeof token !== "string" || !TOKEN.test(token)) return null
  return { server: origin, token, workspace: typeof workspace === "string" ? workspace.slice(0, 200) : null }
}
