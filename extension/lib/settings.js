import { DEFAULT_SERVER } from "../brand.js"

/** Connection to the server: its origin and the API key the connect page handed over. */
export async function getConnection() {
  const { server, token, workspace } = await chrome.storage.local.get(["server", "token", "workspace"])
  return { server: server || DEFAULT_SERVER, token: token || null, workspace: workspace || null }
}

export async function setServer(server) {
  const origin = new URL(server).origin
  const current = await getConnection()
  // A key only works on the server that issued it.
  if (origin !== current.server) await chrome.storage.local.remove(["token", "workspace"])
  await chrome.storage.local.set({ server: origin })
}

export async function disconnect() {
  await chrome.storage.local.remove(["token", "workspace"])
}

/** fetch() against the server with the API key. */
export async function api(path, init = {}) {
  const { server, token } = await getConnection()
  if (!token) throw new Error("Connect the extension first.")
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${token}`)
  const response = await fetch(`${server}${path}`, { ...init, headers })
  if (response.status === 401) {
    await disconnect()
    throw new Error("The extension was disconnected. Connect it again.")
  }
  return response
}

/** The server's error message when it sent one. */
export async function errorFrom(response, fallback) {
  const body = await response.json().catch(() => null)
  return body?.error || fallback
}
