import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { json } from "@/lib/api.server"
import { userApi } from "@/lib/recordings.server"
import { APP_LANGUAGES, languageCookie } from "@/lib/i18n/languages"
import { saveLanguage } from "@/lib/i18n/language.server"

const schema = z.object({ language: z.enum(APP_LANGUAGES) })

/** Saves the signed-in user's app language and sets the cookie that carries it to their other pages. */
export const Route = createFileRoute("/api/preferences/language")({
  server: {
    handlers: {
      PUT: ({ request }) =>
        userApi(request, async (user) => {
          const parsed = schema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) return json({ error: "Unsupported language" }, 400)
          await saveLanguage(user.sub, parsed.data.language)
          const secure = new URL(request.url).protocol === "https:"
          return json({ ok: true, language: parsed.data.language }, { headers: { "set-cookie": languageCookie(parsed.data.language, secure) } })
        }, { sessionOnly: true }),
    },
  },
})
