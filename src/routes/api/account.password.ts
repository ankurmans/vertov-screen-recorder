import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { getCookieSession } from "@/lib/auth.server"
import { userApi } from "@/lib/recordings.server"
import { setAccountPassword } from "@/lib/set-password.server"

export const Route = createFileRoute("/api/account/password")({ server: { handlers: {
  POST: ({ request }) => userApi(request, async (user) => {
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403)
    const session = await getCookieSession(request)
    if (!session) return json({ error: "Sign in first" }, 401)
    const body = await request.json().catch(() => null) as { password?: unknown } | null
    const result = await setAccountPassword(request, user.sub, session.sessionId, body?.password)
    if (result.ok) return json({ ok: true })
    return json({ error: result.error }, { status: result.status, headers: result.retryAfter ? { "retry-after": String(result.retryAfter) } : undefined })
  }, { sessionOnly: true }),
} } })
