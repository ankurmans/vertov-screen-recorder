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
      env.DB.prepare('DELETE FROM session WHERE "userId" = ?').bind(id),
      env.DB.prepare('DELETE FROM account WHERE "userId" = ?').bind(id),
      env.DB.prepare("DELETE FROM workspace_members WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(`p_${id}`),
      env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(id),
    ])
  }
  return { guests: stale.results.length }
}
