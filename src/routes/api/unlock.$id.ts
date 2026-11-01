import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { unlockCookie, verifyPassword } from "@/lib/access.server"
import { json } from "@/lib/api.server"
import { getUploadById } from "@/lib/uploads.server"

const unlockSchema = z.object({ password: z.string().min(1).max(200) })

// Per-isolate throttle; enough to make guessing slow without another binding.
const attempts = new Map<string, { count: number; until: number }>()

/** Trades the right password for a 30-day cookie on this video. */
export const Route = createFileRoute("/api/unlock/$id")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const key = `${params.id}:${request.headers.get("cf-connecting-ip") ?? "local"}`
        const now = Date.now()
        const entry = attempts.get(key)
        if (entry && entry.until > now && entry.count >= 8) return json({ error: "Too many tries" }, 429)

        const upload = await getUploadById(params.id)
        if (!upload?.passwordHash) return json({ error: "Not found" }, 404)
        const parsed = unlockSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success || !(await verifyPassword(parsed.data.password, upload.passwordHash))) {
          const current = entry && entry.until > now ? entry : { count: 0, until: now + 60_000 }
          attempts.set(key, { count: current.count + 1, until: current.until })
          return json({ error: "Wrong password" }, 401)
        }
        attempts.delete(key)
        const response = json({ unlocked: true })
        response.headers.append("set-cookie", await unlockCookie(upload, request))
        return response
      },
    },
  },
})
