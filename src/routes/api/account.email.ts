import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { getCookieSession } from "@/lib/auth.server"
import { clearedLinkNonceCookie, confirmEmailLink, linkNonceCookie, requestEmailLink } from "@/lib/link-email.server"
import { userApi } from "@/lib/recordings.server"

// The link is left unused here, so the person can still open it in the browser that asked for it.
const otherBrowserPage = () => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Open this link in the original browser</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.25rem;color:#1a1c1f}</style></head><body><h1>Open this link in the browser where you asked for it</h1><p>For your security, this confirmation only works in the browser where you requested it. Open this email on that device and use the button there, or ask for a new link from your account settings.</p></body></html>`,
  { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
)

export const Route = createFileRoute("/api/account/email")({ server: { handlers: {
  // A passkey account asks for a link that attaches this email.
  POST: ({ request }) => userApi(request, async (user) => {
    const body = await request.json().catch(() => null) as { email?: unknown } | null
    if (typeof body?.email !== "string") return json({ error: "Enter an email address." }, 400)
    const origin = new URL(request.url).origin
    const result = await requestEmailLink(user.sub, body.email, origin, request.headers)
    if (result.ok) return json({ ok: true }, { headers: { "set-cookie": linkNonceCookie(result.nonce, origin) } })
    return json({ error: result.error }, { status: result.status, headers: result.retryAfter ? { "retry-after": String(result.retryAfter) } : undefined })
  }, { sessionOnly: true }),
  // The link from that email.
  GET: async ({ request }) => {
    const url = new URL(request.url)
    const session = await getCookieSession(request)
    const result = await confirmEmailLink(request, url.searchParams.get("token") ?? "", session?.sessionId)
    if (result.kind === "other_browser") return otherBrowserPage()
    const to = result.kind === "invalid" ? "/signin?email=expired"
      : result.kind === "merged" ? "/signin?email=merged"
        : session?.userId === result.userId ? "/home" : "/signin?email=added"
    return new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", "set-cookie": clearedLinkNonceCookie() } })
  },
} } })
