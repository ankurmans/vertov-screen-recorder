import { CHROME_EXTENSION_ID } from "@/lib/brand"
import { HOSTED_EDITION } from "@/lib/edition"

/** Chrome extension ids are 32 letters a-p. */
export const EXTENSION_ID = /^[a-p]{32}$/

/** The popup makes a 128-bit random state (32 hex characters) for each Connect click; the route only echoes it back. */
export const CONNECT_STATE = /^[a-f0-9]{32}$/

export function parseExtensionId(value: unknown): string | undefined {
  return typeof value === "string" && EXTENSION_ID.test(value) ? value : undefined
}

export function parseConnectState(value: unknown): string | undefined {
  return typeof value === "string" && CONNECT_STATE.test(value) ? value : undefined
}

/** True for the machine running the app (local development), where an unpacked extension has its own id. */
export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost")
}

/**
 * Whether the connect page may hand the API key to this extension id. The hosted site only trusts the published
 * extension; local development and the public (self-hosted) edition accept any well-formed id, because an
 * unpacked extension's id is derived from its folder.
 */
export function extensionAllowed(ext: string | undefined, { local, hosted = HOSTED_EDITION }: { local: boolean; hosted?: boolean }): boolean {
  if (!ext || !EXTENSION_ID.test(ext)) return false
  return !hosted || local || ext === CHROME_EXTENSION_ID
}

/** The fragment the connect page passes to the extension: the key, where it is for, and the popup's state. */
export function connectFragment(input: { server: string; token: string; workspace: string; state: string }): string {
  return new URLSearchParams({ server: input.server, token: input.token, workspace: input.workspace, state: input.state }).toString()
}

/** The same page must never be framed: it hands out an API key on one click. */
export function blockFraming(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("x-frame-options", "DENY")
  headers.set("content-security-policy", "frame-ancestors 'none'")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
