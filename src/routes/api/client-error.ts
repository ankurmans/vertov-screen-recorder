import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { reportError } from "@/lib/error-report.server"
import { allow, clientIp } from "@/lib/rate-limit.server"

/** Browser errors from clientErrorScript. Same-origin only, small, and counted per address and overall so it cannot be flooded. */
export const Route = createFileRoute("/api/client-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin")
        if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Forbidden" }, 403)
        if (Number(request.headers.get("content-length") ?? 0) > 4096) return json({ error: "Too large" }, 413)
        if (!(await allow(`clienterr:${clientIp(request)}`, 10, 3600)) || !(await allow("clienterr", 300, 3600))) return json({ ok: true })
        const body = (await request.json().catch(() => null)) as { name?: unknown; message?: unknown; stack?: unknown; path?: unknown } | null
        if (typeof body?.message !== "string" || !body.message) return json({ error: "Unknown report" }, 400)
        const error = new Error(body.message.slice(0, 500))
        error.name = typeof body.name === "string" ? body.name.slice(0, 80) : "Error"
        error.stack = typeof body.stack === "string" ? `${error.name}: ${error.message}\n${body.stack.slice(0, 1200)}` : undefined
        await reportError(error, { source: "client", route: typeof body.path === "string" ? body.path.slice(0, 200) : undefined })
        return json({ ok: true })
      },
    },
  },
})
