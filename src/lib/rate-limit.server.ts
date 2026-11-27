import { env } from "cloudflare:workers"

/** Counts one hit against `key` in a fixed window; false once the window already holds `limit` hits. */
export async function allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds)
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (key, bucket, n) VALUES (?, ?, 1) ON CONFLICT(key, bucket) DO UPDATE SET n = n + 1 RETURNING n",
  )
    .bind(key, bucket)
    .first<{ n: number }>()
  return (row?.n ?? 1) <= limit
}

export const clientIp = (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown"

/** Sign-in and confirmation emails, counted per hour across every route that sends one. */
export const AUTH_EMAIL_LIMITS = { perAddress: 5, perNetwork: 30, windowSeconds: 3600 } as const

/**
 * One mailbox under the spellings that reach it: case, a `+tag`, and dots in a Gmail address. Only for counting; the
 * email still goes to the address as typed.
 */
export function mailboxKey(email: string): string {
  const address = email.trim().toLowerCase()
  const at = address.lastIndexOf("@")
  if (at < 1) return address
  let local = address.slice(0, at).split("+")[0]
  let domain = address.slice(at + 1)
  if (domain === "googlemail.com") domain = "gmail.com"
  if (domain === "gmail.com") local = local.replaceAll(".", "")
  return `${local}@${domain}`
}

/** The sender's network: an IPv4 address, or the /64 an IPv6 address belongs to (one subscriber usually holds a whole /64). */
export function networkKey(ip: string): string {
  if (!ip.includes(":")) return ip
  const [head, tail = ""] = ip.toLowerCase().split("::")
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`
}

export type AuthEmailVerdict = { ok: true } | { ok: false; retryAfter: number }

/**
 * Whether one more sign-in or confirmation email may go to `email` from this sender. Counted in D1, so every isolate
 * shares the count, and applied the same way whether or not the address has an account.
 */
export async function authEmailAllowed(headers: Headers | null | undefined, email: string): Promise<AuthEmailVerdict> {
  const { perAddress, perNetwork, windowSeconds } = AUTH_EMAIL_LIMITS
  const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds)
  const network = networkKey(headers?.get("cf-connecting-ip") ?? "unknown")
  if (!(await allow(`auth-email-net:${network}`, perNetwork, windowSeconds))) return { ok: false, retryAfter }
  if (!(await allow(`auth-email-to:${mailboxKey(email)}`, perAddress, windowSeconds))) return { ok: false, retryAfter }
  return { ok: true }
}

/** Daily cleanup: old counters, and guest accounts nobody saved or used. Returns what was removed. */
export async function sweepGuests(): Promise<{ guests: number }> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket < ?").bind(Math.floor(Date.now() / 1000 / 3600) - 48).run()
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const stale = await env.DB.prepare(
    `SELECT id FROM "user" WHERE "isAnonymous" = 1 AND "createdAt" < ?
       AND id NOT IN (SELECT "userId" FROM passkey)
       AND id NOT IN (SELECT owner_id FROM uploads WHERE owner_id IS NOT NULL)
       AND id NOT IN (SELECT user_id FROM workspace_members WHERE workspace_id NOT LIKE 'p\\_%' ESCAPE '\\')
     LIMIT 500`,
  )
    .bind(cutoff)
    .all<{ id: string }>()
  for (const { id } of stale.results) {
    await env.DB.batch([
      // Leftovers in the guest's own workspace: keys, tutorial jobs and runners, audit rows. Nothing else can be in it,
      // since the guest owns no uploads and the personal workspace has no other members.
      env.DB.prepare("DELETE FROM api_keys WHERE user_id = ? OR workspace_id = ?").bind(id, `p_${id}`),
      env.DB.prepare("DELETE FROM tutorial_jobs WHERE workspace_id = ?").bind(`p_${id}`),
      env.DB.prepare("DELETE FROM tutorial_runners WHERE workspace_id = ?").bind(`p_${id}`),
      env.DB.prepare("DELETE FROM audit_log WHERE workspace_id = ?").bind(`p_${id}`),
      env.DB.prepare('DELETE FROM session WHERE "userId" = ?').bind(id),
      env.DB.prepare('DELETE FROM account WHERE "userId" = ?').bind(id),
      env.DB.prepare("DELETE FROM workspace_members WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(`p_${id}`),
      env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(id),
    ])
  }
  return { guests: stale.results.length }
}
