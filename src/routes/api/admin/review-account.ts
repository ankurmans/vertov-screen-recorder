import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { z } from "zod"
import { json, protectedApi } from "@/lib/api.server"
import { getAuth } from "@/lib/auth.server"

const body = z.object({ email: z.email(), name: z.string().trim().min(1).max(100), password: z.string().min(12).max(128) })

/**
 * Operator-only (UPLOAD_TOKEN): creates, or resets the password of, an email-and-password account for app-directory
 * reviewers (Claude, OpenAI). Reviewers can't use magic links, email codes or passkeys, and public sign-up stays off.
 */
export const Route = createFileRoute("/api/admin/review-account")({
  server: {
    handlers: {
      POST: ({ request }) =>
        protectedApi(request, env.UPLOAD_TOKEN, async () => {
          const parsed = body.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Send email, name and a password of at least 12 characters." }, 400)
          const { email, name, password } = parsed.data
          const context = await getAuth(request).$context
          const hash = await context.password.hash(password)
          const existing = await context.internalAdapter.findUserByEmail(email.toLowerCase(), { includeAccounts: true })
          if (existing) {
            const credential = existing.accounts.find((account) => account.providerId === "credential")
            if (credential) await context.internalAdapter.updatePassword(existing.user.id, hash)
            else await context.internalAdapter.linkAccount({ providerId: "credential", accountId: existing.user.id, userId: existing.user.id, password: hash })
            return json({ ok: true, userId: existing.user.id, created: false })
          }
          const user = await context.internalAdapter.createUser({ email: email.toLowerCase(), name, emailVerified: true }, { method: "admin" })
          await context.internalAdapter.linkAccount({ providerId: "credential", accountId: user.id, userId: user.id, password: hash })
          return json({ ok: true, userId: user.id, created: true })
        }),
    },
  },
})
