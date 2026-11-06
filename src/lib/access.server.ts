import { env } from "cloudflare:workers"
import type { PublicUpload, Upload } from "@/db/schema"
import { withCors } from "@/lib/api.server"
import { getSessionUser } from "@/lib/auth.server"
import { HOSTED_EDITION } from "@/lib/edition"
import { roleIn } from "@/lib/workspace.server"

export type Access = "open" | "locked" | "expired" | "members" | "removed" | "email" | "unclaimed"

const ITERATIONS = 100_000
const UNLOCK_DAYS = 30

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: ITERATIONS },
    key,
    256,
  )
  return hex(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return `pbkdf2$${salt}$${await pbkdf2(password, salt)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, expected] = stored.split("$")
  if (!salt || !expected) return false
  return (await pbkdf2(password, salt)) === expected
}

/** Cookie value proving this browser typed the current password. Changing the password invalidates it. */
async function unlockToken(upload: Upload): Promise<string> {
  const secret = (env as unknown as Record<string, string | undefined>).BETTER_AUTH_SECRET || "local-dev-secret"
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${upload.id}:${upload.passwordHash}`)))
}

const cookieName = (id: string) => `rl_unlock_${id}`
const emailCookieName = (id: string) => `rl_email_${id}`

async function hmacHex(text: string): Promise<string> {
  const secret = (env as unknown as Record<string, string | undefined>).BETTER_AUTH_SECRET || "local-dev-secret"
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)))
}

/** Cookie proving this browser gave an email address for this video. */
export async function emailCookie(upload: Upload, email: string, request: Request): Promise<string> {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  const value = `${hex(new TextEncoder().encode(email))}.${await hmacHex(`${upload.id}:email:${email}`)}`
  return `${emailCookieName(upload.id)}=${value}; Path=/; Max-Age=${UNLOCK_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`
}

async function hasEmailCookie(upload: Upload, request: Request): Promise<boolean> {
  const value = readCookie(request, emailCookieName(upload.id))
  const [encoded, signature] = (value ?? "").split(".")
  if (!encoded || !signature || encoded.length % 2 !== 0 || /[^0-9a-f]/.test(encoded)) return false
  const bytes = new Uint8Array(encoded.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(encoded.slice(i * 2, i * 2 + 2), 16)
  const email = new TextDecoder().decode(bytes)
  return (await hmacHex(`${upload.id}:email:${email}`)) === signature
}

export async function unlockCookie(upload: Upload, request: Request): Promise<string> {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  return `${cookieName(upload.id)}=${await unlockToken(upload)}; Path=/; Max-Age=${UNLOCK_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return null
}

export function isExpired(upload: Upload): boolean {
  return Boolean(upload.expiresAt) && Date.parse(upload.expiresAt!) <= Date.now()
}

/**
 * True for a guest who has not signed up with Google, an email link or a passkey. Hosted only: their share links work for
 * nobody else until they do. Passkey accounts stay anonymous in the auth table but can sign back in, so they count as claimed.
 */
export async function isUnclaimedGuest(userId: string | null): Promise<boolean> {
  if (!HOSTED_EDITION || !userId) return false
  const row = await env.DB.prepare(
    'SELECT 1 AS guest FROM "user" WHERE id = ? AND "isAnonymous" = 1 AND id NOT IN (SELECT "userId" FROM passkey)',
  )
    .bind(userId)
    .first<{ guest: number }>()
  return Boolean(row)
}

const ownerIsGuest = (upload: Upload) => isUnclaimedGuest(upload.ownerId)

/**
 * Who may watch. The recorder always can (even a removed video, to restore it). Otherwise: removed
 * videos nobody; members-only videos signed-in members of the workspace; then expiry and password.
 */
export async function accessFor(upload: Upload, request: Request): Promise<Access> {
  const expired = isExpired(upload)
  const membersOnly = upload.visibility === "workspace"
  const guestOwned = await ownerIsGuest(upload)
  if (!expired && !upload.passwordHash && !membersOnly && !upload.deletedAt && !upload.requireEmail && !guestOwned) return "open"
  const user = await getSessionUser(request)
  if (user && upload.ownerId === user.sub) return "open"
  if (upload.deletedAt) return "removed"
  if (guestOwned) return "unclaimed"
  if (membersOnly && !(user && (await roleIn(upload.workspaceId, user.sub)))) return "members"
  if (expired) return "expired"
  if (upload.passwordHash && readCookie(request, cookieName(upload.id)) !== (await unlockToken(upload))) return "locked"
  // Members of the video's workspace never have to give an address.
  if (upload.requireEmail && !(user && (await roleIn(upload.workspaceId, user.sub))) && !(await hasEmailCookie(upload, request))) return "email"
  return "open"
}

const DENIED: Record<Exclude<Access, "open">, string> = {
  locked: "Password required",
  expired: "This link has expired",
  members: "Only workspace members can watch this",
  removed: "This video was removed",
  email: "Email required",
  unclaimed: "This video hasn't been shared yet",
}

/** For media/asset routes: a 403 when the viewer can't see this upload, otherwise null. */
export async function denyUnlessViewable(upload: Upload | null, request: Request): Promise<Response | null> {
  if (!upload) return null
  const access = await accessFor(upload, request)
  if (access === "open") return null
  return withCors(new Response(DENIED[access], { status: access === "removed" ? 404 : 403 }))
}

/** The upload as the page may see it: never ship the password hash to the browser. */
export function publicUpload(upload: Upload): PublicUpload {
  const { passwordHash, voiceText, voiceVoiceId, voiceModel, ...rest } = upload
  return { ...rest, hasPassword: Boolean(passwordHash) }
}
