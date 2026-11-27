import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { z } from "zod"
import { json, optionsResponse, protectedApi } from "@/lib/api.server"
import { withoutStoredParams } from "@/lib/error-fingerprint"

/**
 * The error list for the fix agent (docs/error-agent.md). GET returns open errors that have no fix attached yet, newest first,
 * with the ids they touched (never an email or a message body). POST attaches a pull request to one, so the same error is not
 * fixed twice, or sets it to `ignored`. Bearer ERROR_READ_TOKEN only; without the secret every call is refused.
 */
const token = () => String(Reflect.get(env, "ERROR_READ_TOKEN") ?? "")

const bodySchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  fixRef: z.string().url().max(300).optional(),
  status: z.enum(["open", "ignored"]).optional(),
})

export const Route = createFileRoute("/api/ops/errors")({
  server: {
    handlers: {
      GET: ({ request }) =>
        protectedApi(request, token(), async () => {
          const url = new URL(request.url)
          const all = url.searchParams.get("all") === "1"
          const { results } = await env.DB.prepare(
            `SELECT fingerprint, source, name, message, stack, route, status, count, first_seen AS firstSeen, last_seen AS lastSeen, fix_ref AS fixRef
             FROM error_events WHERE status = 'open' ${all ? "" : "AND fix_ref IS NULL"} ORDER BY last_seen DESC LIMIT 25`,
          ).all<{ fingerprint: string; message: string }>()
          const errors = []
          for (const row of results) {
            const affected = await env.DB.prepare("SELECT user_id AS userId, upload_id AS uploadId FROM error_affected WHERE fingerprint = ? LIMIT 20").bind(row.fingerprint).all()
            errors.push({ ...row, message: withoutStoredParams(row.message), affected: affected.results })
          }
          return json({ region: String(Reflect.get(env, "VERTOV_REGION") ?? "us"), errors })
        }),
      POST: ({ request }) =>
        protectedApi(request, token(), async () => {
          const parsed = bodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Invalid body" }, 400)
          const { fingerprint, fixRef, status } = parsed.data
          const result = await env.DB.prepare("UPDATE error_events SET fix_ref = coalesce(?, fix_ref), status = coalesce(?, status) WHERE fingerprint = ?").bind(fixRef ?? null, status ?? null, fingerprint).run()
          return result.meta.changes ? json({ ok: true }) : json({ error: "Unknown fingerprint" }, 404)
        }),
      OPTIONS: () => optionsResponse(),
    },
  },
})
