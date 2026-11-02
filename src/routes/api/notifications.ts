import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/lib/api.server"
import { userApi } from "@/lib/recordings.server"
import { notificationPreferences, saveNotificationPreferences } from "@/lib/notifications.server"

export const Route = createFileRoute("/api/notifications")({ server: { handlers: {
  GET: ({ request }) => userApi(request, async (user) => json(await notificationPreferences(user.sub))),
  PUT: ({ request }) => userApi(request, async (user) => {
    const body = await request.json().catch(() => null) as { comments?: unknown; firstView?: unknown } | null
    if (typeof body?.comments !== "boolean" || typeof body.firstView !== "boolean") return json({ error: "Invalid preferences" }, 400)
    await saveNotificationPreferences(user.sub, body.comments, body.firstView)
    return json({ ok: true })
  }),
} } })
