import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { captureServer } from "@/lib/posthog.server"
import { getAuth } from "@/lib/auth.server"
import { startTrialFor } from "@/lib/workspace.server"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => getAuth(request).handler(request),
      POST: async ({ request }) => {
        const auth = getAuth(request)
        const response = await auth.handler(request)
        // Record durable passkey signup only after a verified registration, never on button click or cancellation.
        if (response.ok && new URL(request.url).pathname === "/api/auth/passkey/verify-registration") {
          try {
            const session = await auth.api.getSession({ headers: request.headers })
            if (session?.user.isAnonymous) {
              const row = await env.DB.prepare("SELECT count(*) AS n FROM passkey WHERE userId=?").bind(session.user.id).first<{ n: number }>()
              if (row?.n === 1) {
                captureServer("account_saved", session.user.id, { method: "passkey" })
                await startTrialFor(session.user.id)
              }
            }
          } catch { /* Analytics must never change an authentication response. */ }
        }
        return response
      },
    },
  },
})
