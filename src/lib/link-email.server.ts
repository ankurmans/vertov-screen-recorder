import { env } from "cloudflare:workers"
import { APP_NAME } from "@/lib/brand"
import { authMailer, isLocalOrigin, moveAccountData, revokeCredentialStatements } from "@/lib/auth.server"
import { allow, authEmailAllowed } from "@/lib/rate-limit.server"
import { emailButton } from "@/lib/email-layout"
import { startTrialFor } from "@/lib/workspace.server"

// A passkey account starts with no email (better-auth's anonymous user), so it can't use Google or email links and
// can't be recovered. This attaches one, confirmed by a link. The link only works in the browser that asked for it:
// opening the mailbox proves who owns the address, not who asked for the link, so the asking browser holds a nonce cookie.

const TOKEN_MINUTES = 60
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const LINK_NONCE_COOKIE = "link_email_nonce"
const LINK_PATH = "/api/account/email"

const sha256 = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("")

const randomHex = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")

const isPasskeyGuest = async (userId: string) =>
  Boolean(await env.DB.prepare('SELECT 1 AS ok FROM "user" WHERE id = ? AND "isAnonymous" = 1').bind(userId).first())

/** The cookie that ties a confirmation link to the browser that asked for it; scoped to the confirmation route. */
export const linkNonceCookie = (nonce: string, origin: string) =>
  `${LINK_NONCE_COOKIE}=${nonce}; Path=${LINK_PATH}; Max-Age=${TOKEN_MINUTES * 60}; HttpOnly; SameSite=Lax${origin.startsWith("https:") ? "; Secure" : ""}`

export const clearedLinkNonceCookie = () => `${LINK_NONCE_COOKIE}=; Path=${LINK_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`

const readCookie = (request: Request, name: string) => {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) return value.join("=")
  }
  return ""
}

export type LinkRequest = { ok: true; nonce: string } | { ok: false; error: string; status: number; retryAfter?: number }

export async function requestEmailLink(userId: string, rawEmail: string, origin: string, headers: Headers): Promise<LinkRequest> {
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 254 || email.endsWith(".invalid")) return { ok: false, error: "Enter a valid email address.", status: 400 }
  if (!(await isPasskeyGuest(userId))) return { ok: false, error: "This account already has an email.", status: 409 }
  if (!(await allow(`link-email:${userId}`, 5, 3600))) return { ok: false, error: "Too many links sent. Try again in an hour.", status: 429, retryAfter: 3600 }
  // Shared with sign-in links, so the address and the network have one count however many guests ask.
  const sending = await authEmailAllowed(headers, email)
  if (!sending.ok) return { ok: false, error: "Too many emails sent. Try again later.", status: 429, retryAfter: sending.retryAfter }

  const token = randomHex()
  const nonce = randomHex()
  const now = new Date()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM verification WHERE identifier LIKE 'link-email:%' AND value LIKE ?").bind(`%"userId":"${userId}"%`),
    env.DB.prepare('INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)').bind(
      crypto.randomUUID(),
      `link-email:${await sha256(token)}`,
      JSON.stringify({ userId, email, nonceHash: await sha256(nonce) }),
      new Date(now.getTime() + TOKEN_MINUTES * 60_000).toISOString(),
      now.toISOString(),
      now.toISOString(),
    ),
  ])

  const url = `${origin}${LINK_PATH}?token=${token}`
  const mail = authMailer()
  if (mail.EMAIL && mail.EMAIL_FROM) {
    await mail.EMAIL.send({
      audit: { stream: "transactional", template: "confirm-email" },
      to: email,
      from: mail.EMAIL_FROM,
      subject: "Confirm your email ✉️",
      text: `Confirm this email for your ${APP_NAME} account:\n\n${url}\n\nOpen it in the browser where you asked for it. Confirming this email lets you get back into your account if you lose your passkey, and sign in with Google or an email link. The link works once and expires in ${TOKEN_MINUTES} minutes. If you didn't make a ${APP_NAME} account, ignore this email.`,
      html: confirmHtml(url),
    })
  } else if (isLocalOrigin(origin)) {
    console.log(`\n[email link for ${email}] ${url}\n`)
  } else {
    return { ok: false, error: "Email isn't set up yet.", status: 503 }
  }
  return { ok: true, nonce }
}

export type LinkResult = { kind: "added"; userId: string } | { kind: "merged"; userId: string } | { kind: "invalid" } | { kind: "other_browser" }

/**
 * Applies a confirmation link, only in the browser that asked for it (the nonce cookie from requestEmailLink); anywhere
 * else the link is left unused and the caller says where to open it. An address nobody uses becomes this account's, and
 * its other sessions, API keys and OAuth tokens end. An address that already has an account gets this account's videos
 * and workspaces, but not the passkey or any credential: whoever opens the link proves they own the email, not that they
 * made the passkey, so a stranger's passkey, key or token never lands on someone's account.
 * `keepSessionId` is the browser session that stays signed in when the address is adopted.
 */
export async function confirmEmailLink(request: Request, token: string, keepSessionId?: string): Promise<LinkResult> {
  if (!/^[a-f0-9]{48}$/.test(token)) return { kind: "invalid" }
  const identifier = `link-email:${await sha256(token)}`
  const row = await env.DB.prepare('SELECT value, "expiresAt" AS expiresAt FROM verification WHERE identifier = ?').bind(identifier).first<{ value: string; expiresAt: string }>()
  if (!row) return { kind: "invalid" }
  if (Date.parse(row.expiresAt) <= Date.now()) {
    await env.DB.prepare("DELETE FROM verification WHERE identifier = ?").bind(identifier).run()
    return { kind: "invalid" }
  }
  const { userId, email, nonceHash } = JSON.parse(row.value) as { userId: string; email: string; nonceHash?: string }
  // Checked before the link is used up, so a mail scanner or another browser opening it doesn't burn it.
  const nonce = readCookie(request, LINK_NONCE_COOKIE)
  if (!nonceHash || !/^[a-f0-9]{48}$/.test(nonce) || (await sha256(nonce)) !== nonceHash) return { kind: "other_browser" }
  await env.DB.prepare("DELETE FROM verification WHERE identifier = ?").bind(identifier).run()
  if (!(await isPasskeyGuest(userId))) return { kind: "invalid" }

  const existing = await env.DB.prepare('SELECT id FROM "user" WHERE lower(email) = ? AND id != ?').bind(email, userId).first<{ id: string }>()
  const now = new Date().toISOString()
  if (!existing) {
    await env.DB.batch([
      env.DB.prepare('UPDATE "user" SET email = ?, "emailVerified" = 1, "isAnonymous" = 0, "updatedAt" = ? WHERE id = ?').bind(email, now, userId),
      keepSessionId ? env.DB.prepare('DELETE FROM session WHERE "userId" = ? AND id != ?').bind(userId, keepSessionId) : env.DB.prepare('DELETE FROM session WHERE "userId" = ?').bind(userId),
      ...revokeCredentialStatements(userId, now),
    ])
    await startTrialFor(userId)
    return { kind: "added", userId }
  }
  await moveAccountData(userId, existing.id)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM session WHERE "userId" = ?').bind(userId),
    env.DB.prepare('DELETE FROM passkey WHERE "userId" = ?').bind(userId),
    env.DB.prepare('DELETE FROM account WHERE "userId" = ?').bind(userId),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(userId),
  ])
  await startTrialFor(existing.id)
  return { kind: "merged", userId: existing.id }
}

const confirmHtml = (url: string) => `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;letter-spacing:-.7px">Confirm your email</h1>
<p style="margin:0 0 20px">Confirm this email so you can get back into your account if you lose your passkey.</p>
<p style="margin:0 0 14px;font-weight:bold">Open the link in the browser where you asked for it.</p>
<p style="margin:0 0 20px">You can then sign in with Google or an email link. This link works once and expires in ${TOKEN_MINUTES} minutes.</p>
${emailButton(url, "Confirm email")}
<p style="margin:16px 0 0;font-size:13px;color:#585b60">Didn't make a ${APP_NAME} account? You can ignore this.</p>`
