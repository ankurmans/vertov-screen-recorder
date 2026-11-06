import { env } from "cloudflare:workers"
import { APP_NAME } from "@/lib/brand"
import { authMailer, isLocalOrigin, moveAccountData } from "@/lib/auth.server"
import { allow } from "@/lib/rate-limit.server"

// A passkey account starts with no email (better-auth's anonymous user), so it can't use Google or email links and
// can't be recovered. This attaches one, confirmed by a link, and works when the link is opened on another device.

const TOKEN_MINUTES = 60
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const sha256 = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("")

const isPasskeyGuest = async (userId: string) =>
  Boolean(await env.DB.prepare('SELECT 1 AS ok FROM "user" WHERE id = ? AND "isAnonymous" = 1').bind(userId).first())

export type LinkRequest = { ok: true } | { ok: false; error: string; status: number }

export async function requestEmailLink(userId: string, rawEmail: string, origin: string): Promise<LinkRequest> {
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 254 || email.endsWith(".invalid")) return { ok: false, error: "Enter a valid email address.", status: 400 }
  if (!(await isPasskeyGuest(userId))) return { ok: false, error: "This account already has an email.", status: 409 }
  if (!(await allow(`link-email:${userId}`, 5, 3600))) return { ok: false, error: "Too many links sent. Try again in an hour.", status: 429 }

  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")
  const now = new Date()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM verification WHERE identifier LIKE 'link-email:%' AND value LIKE ?").bind(`%"userId":"${userId}"%`),
    env.DB.prepare('INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)').bind(
      crypto.randomUUID(),
      `link-email:${await sha256(token)}`,
      JSON.stringify({ userId, email }),
      new Date(now.getTime() + TOKEN_MINUTES * 60_000).toISOString(),
      now.toISOString(),
      now.toISOString(),
    ),
  ])

  const url = `${origin}/api/account/email?token=${token}`
  const mail = authMailer()
  if (mail.EMAIL && mail.EMAIL_FROM) {
    await mail.EMAIL.send({
      to: email,
      from: mail.EMAIL_FROM,
      subject: `Confirm your email for ${APP_NAME}`,
      text: `Confirm this email for your ${APP_NAME} account:\n\n${url}\n\nThen you can also sign in with Google or an email link, and get back in if you lose your passkey. The link works once and expires in ${TOKEN_MINUTES} minutes. If you didn't make a ${APP_NAME} account, ignore this email.`,
      html: confirmHtml(url),
    })
  } else if (isLocalOrigin(origin)) {
    console.log(`\n[email link for ${email}] ${url}\n`)
  } else {
    return { ok: false, error: "Email isn't set up yet.", status: 503 }
  }
  return { ok: true }
}

export type LinkResult = { kind: "added"; userId: string } | { kind: "merged"; userId: string } | { kind: "invalid" }

/**
 * Applies a confirmation link. An address nobody uses becomes this account's. An address that already has an account
 * gets this account's videos and workspaces, but not the passkey: whoever opens the link proves they own the email,
 * not that they made the passkey, so a stranger's passkey never lands on someone's account.
 */
export async function confirmEmailLink(token: string): Promise<LinkResult> {
  if (!/^[a-f0-9]{48}$/.test(token)) return { kind: "invalid" }
  const identifier = `link-email:${await sha256(token)}`
  const row = await env.DB.prepare('SELECT value, "expiresAt" AS expiresAt FROM verification WHERE identifier = ?').bind(identifier).first<{ value: string; expiresAt: string }>()
  if (!row) return { kind: "invalid" }
  await env.DB.prepare("DELETE FROM verification WHERE identifier = ?").bind(identifier).run()
  if (Date.parse(row.expiresAt) <= Date.now()) return { kind: "invalid" }
  const { userId, email } = JSON.parse(row.value) as { userId: string; email: string }
  if (!(await isPasskeyGuest(userId))) return { kind: "invalid" }

  const existing = await env.DB.prepare('SELECT id FROM "user" WHERE lower(email) = ? AND id != ?').bind(email, userId).first<{ id: string }>()
  const now = new Date().toISOString()
  if (!existing) {
    await env.DB.prepare('UPDATE "user" SET email = ?, "emailVerified" = 1, "isAnonymous" = 0, "updatedAt" = ? WHERE id = ?').bind(email, now, userId).run()
    return { kind: "added", userId }
  }
  await moveAccountData(userId, existing.id)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM session WHERE "userId" = ?').bind(userId),
    env.DB.prepare('DELETE FROM passkey WHERE "userId" = ?').bind(userId),
    env.DB.prepare('DELETE FROM account WHERE "userId" = ?').bind(userId),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(userId),
  ])
  return { kind: "merged", userId: existing.id }
}

const confirmHtml = (url: string) => `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:system-ui,sans-serif;color:#171717">
<div style="max-width:440px;margin:40px auto;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:28px">
<h1 style="margin:0 0 8px;font-size:22px">Confirm your email</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#525252">Then you can also sign in to ${APP_NAME} with Google or an email link, and get back in if you lose your passkey. The button works once and expires in ${TOKEN_MINUTES} minutes.</p>
<a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;border-radius:10px;padding:12px 20px;font-weight:600;font-size:15px;text-decoration:none">Confirm email</a>
<p style="margin:22px 0 0;font-size:13px;color:#737373">Didn't make a ${APP_NAME} account? You can ignore this.</p>
</div></body></html>`
