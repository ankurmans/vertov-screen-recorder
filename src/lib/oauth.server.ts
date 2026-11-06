import { env } from "cloudflare:workers"
import { seal, unseal } from "@/lib/secret-box.server"
import type { SessionUser } from "@/lib/auth.server"
import { AGENT_COUNTER_KEY, countAppEvent } from "@/lib/activation-events.server"

/**
 * OAuth 2.1 authorization server for the MCP endpoint, so Claude, ChatGPT and Codex can connect with a sign-in instead of
 * a pasted API key. Written to the Claude connector and OpenAI plugin auth docs (read 2026-11-04):
 * - discovery: RFC 9728 protected resource metadata (resource = `${origin}/mcp`) and RFC 8414 server metadata;
 * - clients: Dynamic Client Registration (RFC 7591) or a Client ID Metadata Document (client_id is an https URL);
 * - authorization code + S256 PKCE only, `iss` on every authorization response (RFC 9207), `resource` bound to the token;
 * - refresh tokens rotate on every use; loopback redirects (Claude Code) match on any port.
 * Tokens are opaque and stored hashed. A connection is pinned to one workspace, like an API key.
 */

export const SCOPE = "mcp"
const OFFLINE = "offline_access"
const CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TTL_S = 60 * 60
const REFRESH_TTL_MS = 90 * 86_400_000
const CIMD_TTL_MS = 86_400_000
/** How long a refresh token that was just rotated still gets the same answer, so duplicate refreshes don't break a connection. */
const REFRESH_GRACE_MS = 2 * 60 * 1000

export const resourceUrl = (origin: string) => `${origin}/mcp`
export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/mcp`

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Vertov",
    resource_documentation: `${origin}/docs/mcp`,
    resource_policy_uri: `${origin}/privacy`,
    resource_tos_uri: `${origin}/terms`,
  }
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE, OFFLINE],
    // URL client_ids (CIMD) are accepted, but not advertised until fetching Claude's and ChatGPT's documents from the
    // Worker is confirmed; both clients use DCR when this is absent.
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/docs/mcp`,
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description)
  }
}

export interface Client {
  id: string
  name: string
  redirectUris: Array<string>
  /** Null for public clients (PKCE only). */
  secretHash: string | null
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

function isLoopback(uri: URL): boolean {
  return uri.protocol === "http:" && LOOPBACK.has(uri.hostname)
}

/** https anywhere, or http on a loopback address (native clients such as Claude Code). No fragments. */
function validRedirect(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 500) return false
  try {
    const uri = new URL(raw)
    if (uri.hash) return false
    return uri.protocol === "https:" || isLoopback(uri)
  } catch {
    return false
  }
}

/** Exact match, except that loopback redirects match on any port (RFC 8252 section 7.3, and localhost for Claude Code). */
export function redirectAllowed(client: Client, raw: string): boolean {
  if (client.redirectUris.includes(raw)) return true
  let wanted: URL
  try {
    wanted = new URL(raw)
  } catch {
    return false
  }
  if (!isLoopback(wanted)) return false
  return client.redirectUris.some((registered) => {
    try {
      const uri = new URL(registered)
      return isLoopback(uri) && uri.hostname === wanted.hostname && uri.pathname === wanted.pathname && uri.search === wanted.search
    } catch {
      return false
    }
  })
}

function rowToClient(row: { id: string; name: string; redirect_uris: string; secret_hash: string | null }): Client {
  return { id: row.id, name: row.name, redirectUris: JSON.parse(row.redirect_uris) as Array<string>, secretHash: row.secret_hash }
}

/** RFC 7591 registration. Public clients (token_endpoint_auth_method "none") get no secret. */
export async function registerClient(body: unknown) {
  const input = (body ?? {}) as Record<string, unknown>
  const redirectUris = input.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(validRedirect)) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be 1 to 10 https URLs, or http loopback URLs.")
  }
  const method = typeof input.token_endpoint_auth_method === "string" ? input.token_endpoint_auth_method : "client_secret_basic"
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.")
  }
  const grants = Array.isArray(input.grant_types) ? input.grant_types : ["authorization_code"]
  if (!grants.every((grant) => grant === "authorization_code" || grant === "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "Only the authorization_code and refresh_token grants are supported.")
  }
  const name = (typeof input.client_name === "string" ? input.client_name.trim() : "").slice(0, 100) || "An MCP client"
  const id = `vc_${randomHex(16)}`
  const secret = method === "none" ? null : `vcs_${randomHex(24)}`
  const now = new Date()
  await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, kind, created_at) VALUES (?, ?, ?, ?, 'dcr', ?)")
    .bind(id, name, JSON.stringify(redirectUris), secret ? await sha256(secret) : null, now.toISOString())
    .run()
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }
}

/** Fetches a Client ID Metadata Document: an https URL whose JSON names the same client_id. Public clients only. */
async function fetchMetadataDocument(clientId: string): Promise<Client> {
  const url = new URL(clientId)
  if (url.protocol !== "https:" || url.hash || url.username || url.password || /^[\d.]+$|^\[/.test(url.hostname)) {
    throw new OAuthError("invalid_client", "client_id must be an https URL on a domain name.")
  }
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => null)
  if (!response?.ok) throw new OAuthError("invalid_client", "The client's metadata document couldn't be fetched.")
  const raw = await response.text()
  if (raw.length > 20_000) throw new OAuthError("invalid_client", "The client's metadata document is too large.")
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new OAuthError("invalid_client", "The client's metadata document isn't JSON.")
  }
  if (doc.client_id !== clientId) throw new OAuthError("invalid_client", "The metadata document's client_id doesn't match its URL.")
  const redirectUris = doc.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(validRedirect)) {
    throw new OAuthError("invalid_client", "The metadata document has no valid redirect_uris.")
  }
  const name = (typeof doc.client_name === "string" ? doc.client_name.trim() : "").slice(0, 100) || url.hostname
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, kind, created_at, fetched_at) VALUES (?, ?, ?, NULL, 'cimd', ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at`,
  )
    .bind(clientId, name, JSON.stringify(redirectUris), now, now)
    .run()
  return { id: clientId, name, redirectUris, secretHash: null }
}

export async function findClient(clientId: unknown): Promise<Client> {
  if (typeof clientId !== "string" || !clientId || clientId.length > 500) throw new OAuthError("invalid_client", "Missing client_id.")
  const row = await env.DB.prepare("SELECT id, name, redirect_uris, secret_hash, kind, fetched_at FROM oauth_clients WHERE id = ?")
    .bind(clientId)
    .first<{ id: string; name: string; redirect_uris: string; secret_hash: string | null; kind: string; fetched_at: string | null }>()
  if (clientId.startsWith("https://")) {
    if (row && row.fetched_at && Date.now() - Date.parse(row.fetched_at) < CIMD_TTL_MS) return rowToClient(row)
    return fetchMetadataDocument(clientId)
  }
  if (!row) throw new OAuthError("invalid_client", "Unknown client. Register it first.", 401)
  return rowToClient(row)
}

/** Client authentication at the token and revocation endpoints: none for public clients, else the secret (post or basic). */
async function authenticateClient(form: URLSearchParams, request: Request): Promise<Client> {
  let clientId = form.get("client_id")
  let secret = form.get("client_secret")
  const header = request.headers.get("authorization")
  if (header?.startsWith("Basic ")) {
    try {
      const [id, ...rest] = atob(header.slice(6)).split(":")
      clientId = decodeURIComponent(id)
      secret = decodeURIComponent(rest.join(":"))
    } catch {
      throw new OAuthError("invalid_client", "Malformed Basic credentials.", 401)
    }
  }
  const client = await findClient(clientId)
  if (client.secretHash && (!secret || (await sha256(secret)) !== client.secretHash)) {
    throw new OAuthError("invalid_client", "Client authentication failed.", 401)
  }
  return client
}

export interface AuthorizeRequest {
  client: Client
  redirectUri: string
  state: string | null
  codeChallenge: string
  scope: string
  resource: string
}

/**
 * Checks an authorization request. Problems with the client or redirect URI throw (the page shows them, never redirects);
 * the rest come back as an error to send to the client's redirect URI.
 */
export async function checkAuthorizeRequest(params: Record<string, unknown>, origin: string): Promise<AuthorizeRequest | { redirectError: string; description: string; redirectUri: string; state: string | null }> {
  const client = await findClient(params.client_id)
  const redirectUri = typeof params.redirect_uri === "string" ? params.redirect_uri : client.redirectUris.length === 1 ? client.redirectUris[0] : ""
  if (!redirectUri || !redirectAllowed(client, redirectUri)) throw new OAuthError("invalid_request", "This redirect URI isn't registered for the client.")
  const state = typeof params.state === "string" ? params.state : null
  const fail = (code: string, description: string) => ({ redirectError: code, description, redirectUri, state })
  if (params.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.")
  if (typeof params.code_challenge !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge)) return fail("invalid_request", "A PKCE code_challenge is required.")
  if (params.code_challenge_method !== "S256") return fail("invalid_request", "code_challenge_method must be S256.")
  const resource = typeof params.resource === "string" && params.resource ? params.resource : resourceUrl(origin)
  if (resource !== resourceUrl(origin)) return fail("invalid_target", `resource must be ${resourceUrl(origin)}.`)
  const requested = typeof params.scope === "string" ? params.scope.split(" ").filter(Boolean) : []
  if (requested.some((scope) => scope !== SCOPE && scope !== OFFLINE)) return fail("invalid_scope", `Supported scopes: ${SCOPE} ${OFFLINE}.`)
  return { client, redirectUri, state, codeChallenge: params.code_challenge, scope: SCOPE, resource }
}

/** The redirect back to the client, always carrying `iss` (RFC 9207). */
export function clientRedirect(redirectUri: string, origin: string, values: Record<string, string | null>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(values)) if (value !== null) url.searchParams.set(key, value)
  url.searchParams.set("iss", origin)
  return url.toString()
}

export async function issueCode(request: AuthorizeRequest, userId: string, workspaceId: string): Promise<string> {
  const code = randomHex(32)
  await env.DB.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, workspace_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(code), request.client.id, userId, workspaceId, request.redirectUri, request.codeChallenge, request.scope, request.resource, new Date(Date.now() + CODE_TTL_MS).toISOString())
    .run()
  return code
}

async function tokenResponse(id: string, scope: string) {
  const access = `vat_${randomHex(20)}`
  const refresh = `vrt_${randomHex(24)}`
  return {
    id,
    accessHash: await sha256(access),
    refreshHash: await sha256(refresh),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
    body: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope },
  }
}

/** The token endpoint: authorization_code (with PKCE) and refresh_token (rotating). */
export async function token(form: URLSearchParams, request: Request) {
  const client = await authenticateClient(form, request)
  const grant = form.get("grant_type")
  if (grant === "authorization_code") {
    const code = form.get("code") ?? ""
    const hash = await sha256(code)
    // Deleting first makes a code single-use even under concurrent exchanges.
    const row = await env.DB.prepare("DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *")
      .bind(hash)
      .first<{ client_id: string; user_id: string; workspace_id: string; redirect_uri: string; code_challenge: string; scope: string; resource: string; expires_at: string }>()
    if (!row || Date.parse(row.expires_at) <= Date.now() || row.client_id !== client.id) throw new OAuthError("invalid_grant", "The code is invalid, used or expired.")
    if (form.get("redirect_uri") !== null && form.get("redirect_uri") !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request.")
    const verifier = form.get("code_verifier") ?? ""
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant", "A valid code_verifier is required.")
    if (base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))) !== row.code_challenge) throw new OAuthError("invalid_grant", "PKCE verification failed.")
    const resource = form.get("resource")
    if (resource && resource !== row.resource) throw new OAuthError("invalid_target", "resource doesn't match the authorization request.")
    const issued = await tokenResponse(crypto.randomUUID(), row.scope)
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (id, access_hash, refresh_hash, client_id, client_name, user_id, workspace_id, scope, resource, access_expires_at, refresh_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(issued.id, issued.accessHash, issued.refreshHash, client.id, client.name, row.user_id, row.workspace_id, row.scope, row.resource, issued.accessExpiresAt, issued.refreshExpiresAt, new Date().toISOString())
      .run()
    await countAppEvent({ key: AGENT_COUNTER_KEY, event: "mcp_connected" })
    return issued.body
  }
  if (grant === "refresh_token") {
    const hash = await sha256(form.get("refresh_token") ?? "")
    type Row = { id: string; client_id: string; scope: string; resource: string; refresh_expires_at: string; revoked_at: string | null; refresh_hash: string; prev_refresh_hash: string | null; last_response: string | null; rotated_at: string | null }
    const find = () =>
      env.DB.prepare(
        "SELECT id, client_id, scope, resource, refresh_expires_at, revoked_at, refresh_hash, prev_refresh_hash, last_response, rotated_at FROM oauth_tokens WHERE refresh_hash = ? OR prev_refresh_hash = ?",
      )
        .bind(hash, hash)
        .first<Row>()
    /** The refresh token was rotated moments ago: answer with the same tokens the first caller got. */
    const replay = async (row: Row) => {
      if (row.prev_refresh_hash !== hash || !row.last_response || !row.rotated_at || Date.now() - Date.parse(row.rotated_at) > REFRESH_GRACE_MS) return null
      const text = await unseal(row.last_response)
      return text ? (JSON.parse(text) as Record<string, unknown>) : null
    }
    const row = await find()
    if (!row || row.revoked_at || Date.parse(row.refresh_expires_at) <= Date.now() || row.client_id !== client.id) {
      throw new OAuthError("invalid_grant", "The refresh token is invalid, revoked or expired.")
    }
    const resource = form.get("resource")
    if (resource && resource !== row.resource) throw new OAuthError("invalid_target", "resource doesn't match this connection.")
    if (row.refresh_hash !== hash) {
      const again = await replay(row)
      if (again) return again
      throw new OAuthError("invalid_grant", "The refresh token was already used.")
    }
    const issued = await tokenResponse(row.id, row.scope)
    const updated = await env.DB.prepare(
      "UPDATE oauth_tokens SET access_hash = ?, refresh_hash = ?, access_expires_at = ?, refresh_expires_at = ?, prev_refresh_hash = ?, last_response = ?, rotated_at = ? WHERE id = ? AND refresh_hash = ?",
    )
      .bind(issued.accessHash, issued.refreshHash, issued.accessExpiresAt, issued.refreshExpiresAt, hash, await seal(JSON.stringify(issued.body)), new Date().toISOString(), row.id, hash)
      .run()
    if (!updated.meta.changes) {
      // Lost a simultaneous race: the winner's response is the answer.
      const winner = await find()
      const again = winner && !winner.revoked_at ? await replay(winner) : null
      if (again) return again
      throw new OAuthError("invalid_grant", "The refresh token was already used.")
    }
    return issued.body
  }
  throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.")
}

/** RFC 7009: revoke the connection behind an access or refresh token. Always succeeds for unknown tokens. */
export async function revoke(form: URLSearchParams, request: Request) {
  const client = await authenticateClient(form, request)
  const hash = await sha256(form.get("token") ?? "")
  await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE (access_hash = ? OR refresh_hash = ?) AND client_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), hash, hash, client.id)
    .run()
}

const TOUCH_MS = 60 * 60 * 1000

/** The user behind an OAuth access token, pinned to the connection's workspace. Null if invalid, expired or for another resource. */
export async function userForOAuthToken(accessToken: string, origin: string): Promise<SessionUser | null> {
  if (!/^vat_[a-f0-9]{40}$/.test(accessToken)) return null
  const row = await env.DB.prepare(
    `SELECT t.id, t.workspace_id AS workspaceId, t.resource, t.access_expires_at AS expiresAt, t.last_used_at AS lastUsedAt,
            u.id AS userId, u.name, u.email, u.image, u."isAnonymous" AS anon
     FROM oauth_tokens t JOIN "user" u ON u.id = t.user_id
     WHERE t.access_hash = ? AND t.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = t.workspace_id AND m.user_id = t.user_id)`,
  )
    .bind(await sha256(accessToken))
    .first<{ id: string; workspaceId: string; resource: string; expiresAt: string; lastUsedAt: string | null; userId: string; name: string; email: string; image: string | null; anon: number | null }>()
  if (!row || Date.parse(row.expiresAt) <= Date.now() || row.resource !== resourceUrl(origin)) return null
  if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > TOUCH_MS) {
    await env.DB.prepare("UPDATE oauth_tokens SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run()
  }
  const name = row.name.trim() || (row.anon ? "Passkey user" : row.email.split("@")[0])
  return {
    sub: row.userId,
    name,
    avatar: row.image || `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(name)}`,
    email: row.anon ? null : row.email,
    workspaceId: row.workspaceId,
  }
}

/** Apps the user has connected over OAuth, for Settings. */
export async function listConnections(userId: string) {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.client_name AS clientName, t.created_at AS createdAt, t.last_used_at AS lastUsedAt, w.name AS workspaceName
     FROM oauth_tokens t LEFT JOIN workspaces w ON w.id = t.workspace_id
     WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.refresh_expires_at > ? ORDER BY t.created_at DESC`,
  )
    .bind(userId, new Date().toISOString())
    .all<{ id: string; clientName: string; createdAt: string; lastUsedAt: string | null; workspaceName: string | null }>()
  return rows.results
}

export async function revokeConnection(userId: string, id: string): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), id, userId)
    .run()
  return result.meta.changes > 0
}

/** Daily: drop expired codes, and connections that are revoked or past their refresh lifetime. */
export async function sweepOAuth() {
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_tokens WHERE refresh_expires_at < ? OR revoked_at IS NOT NULL").bind(now),
  ])
}
