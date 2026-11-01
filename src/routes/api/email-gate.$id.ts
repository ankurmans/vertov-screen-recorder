import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { db } from "@/db"
import { viewerEmails } from "@/db/schema"
import { emailCookie } from "@/lib/access.server"
import { json } from "@/lib/api.server"
import { getUploadById } from "@/lib/uploads.server"

const schema = z.object({ email: z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) })

/** Trades an email address for a 30-day cookie on a video whose owner asked for one. */
export const Route = createFileRoute("/api/email-gate/$id")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        if (!upload?.requireEmail) return json({ error: "Not found" }, 404)
        const parsed = schema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return json({ error: "Enter a valid email address" }, 400)
        await db.insert(viewerEmails).values({ uploadId: upload.id, email: parsed.data.email }).onConflictDoNothing()
        const response = json({ ok: true })
        response.headers.append("set-cookie", await emailCookie(upload, parsed.data.email, request))
        return response
      },
    },
  },
})
