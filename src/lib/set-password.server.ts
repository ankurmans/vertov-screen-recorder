import { env } from "cloudflare:workers"
import { getAuth } from "@/lib/auth.server"
import { allow, clientIp } from "@/lib/rate-limit.server"
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/set-password-rules"

export { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/set-password-rules"
/** A password can be replaced only by someone who proved the mailbox in the last quarter hour (an email link just clicked). */
export const FRESH_SESSION_MS = 15 * 60 * 1000

export type SetPasswordResult = { ok: true } | { ok: false; status: number; error: string; retryAfter?: number }

const toMs = (value: unknown): number => {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(String(value ?? ""))
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Lets a signed-in person with a proven email choose a password. There is no public password sign-up: the password
 * only exists after the mailbox was proven (email link, Google or company sign-in), so nobody can claim an address
 * with a password the real owner never chose. Replacing an existing password needs a session less than 15 minutes
 * old, which is what "Forgot your password? Email me a link" gives, and it signs every other session out.
 */
export async function setAccountPassword(request: Request, userId: string, sessionId: string, password: unknown): Promise<SetPasswordResult> {
  if (typeof password !== "string" || !password) return { ok: false, status: 400, error: "Enter a password." }
  if (password.length < PASSWORD_MIN) return { ok: false, status: 400, error: `Use at least ${PASSWORD_MIN} characters.` }
  if (password.length > PASSWORD_MAX) return { ok: false, status: 400, error: `Use at most ${PASSWORD_MAX} characters.` }
  if (!(await allow(`set-password:${userId}:${clientIp(request)}`, 5, 900))) {
    return { ok: false, status: 429, error: "Too many attempts. Try again in 15 minutes.", retryAfter: 900 }
  }
  const user = await env.DB.prepare(`SELECT email, "emailVerified" AS verified, "isAnonymous" AS anon FROM "user" WHERE id = ?`)
    .bind(userId)
    .first<{ email: string | null; verified: number | null; anon: number | null }>()
  if (!user || user.anon || !user.verified) {
    return { ok: false, status: 403, error: "Confirm your email first. Sign in with an email link, then choose a password." }
  }
  if (user.email && password.trim().toLowerCase() === user.email.trim().toLowerCase()) {
    return { ok: false, status: 400, error: "Choose a password that isn't your email address." }
  }
  const existing = await env.DB.prepare(`SELECT id FROM account WHERE "userId" = ? AND "providerId" = 'credential'`).bind(userId).first<{ id: string }>()
  let replaced = false
  if (existing) {
    const session = await env.DB.prepare(`SELECT "createdAt" AS created FROM session WHERE id = ? AND "userId" = ?`).bind(sessionId, userId).first<{ created: unknown }>()
    if (!session || Date.now() - toMs(session.created) > FRESH_SESSION_MS) {
      return { ok: false, status: 403, error: "For your security, sign in with an email link first (Forgot your password?), then choose the new password." }
    }
    await env.DB.prepare(`DELETE FROM account WHERE id = ?`).bind(existing.id).run()
    replaced = true
  }
  const response = await getAuth(request).api.setPassword({ body: { newPassword: password }, headers: request.headers, asResponse: true })
  if (!response.ok) return { ok: false, status: 400, error: "The password could not be saved. Try again." }
  if (replaced) await env.DB.prepare(`DELETE FROM session WHERE "userId" = ? AND id != ?`).bind(userId, sessionId).run()
  return { ok: true }
}
