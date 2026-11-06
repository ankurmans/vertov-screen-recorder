import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { getSessionUser } from "@/lib/auth.server"
import { confirmEmailLink, requestEmailLink } from "@/lib/link-email.server"
import { userApi } from "@/lib/recordings.server"

export const Route = createFileRoute("/api/account/email")({ server: { handlers: {
  // A passkey account asks for a link that attaches this email.
  POST: ({ request }) => userApi(request, async (user) => {
    const body = await request.json().catch(() => null) as { email?: unknown } | null
    if (typeof body?.email !== "string") return json({ error: "Enter an email address." }, 400)
    const result = await requestEmailLink(user.sub, body.email, new URL(request.url).origin)
    return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status)
  }),
  // The link from that email.
  GET: async ({ request }) => {
    const url = new URL(request.url)
    const result = await confirmEmailLink(url.searchParams.get("token") ?? "")
    const viewer = result.kind === "added" ? await getSessionUser(request) : null
    const to = result.kind === "invalid" ? "/signin?email=expired"
      : result.kind === "merged" ? "/signin?email=merged"
        : viewer?.sub === result.userId ? "/home" : "/signin?email=added"
    return new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } })
  },
} } })
