import { allow } from "@/lib/rate-limit.server"
import { captionTranslation, translatedLanguages, translateCaptions } from "@/lib/translation.server"
import { ownedUpload, userApi } from "@/lib/recordings.server"
import { json } from "@/lib/api.server"
import { CAPTION_LANGUAGES } from "@/lib/caption-languages"
import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { denyUnlessViewable } from "@/lib/access.server"
import { optionsResponse, withCors } from "@/lib/api.server"
import { parseTranscript, transcriptToVtt, vttToSrt } from "@/lib/transcript"
import { getUploadById } from "@/lib/uploads.server"

/** WebVTT captions generated from the stored transcript sidecar. */
export const Route = createFileRoute("/api/captions/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const upload = await getUploadById(params.id)
        const denied = await denyUnlessViewable(upload, request)
        if (denied) return denied
        if (!upload?.transcriptKey) {
          return withCors(new Response("Not found", { status: 404 }))
        }

        const query = new URL(request.url).searchParams
        // ?format=srt downloads SubRip instead of serving WebVTT to the player.
        const srt = query.get("format") === "srt"
        const name = (upload.title?.trim() || upload.id).replace(/[^\w .-]+/g, "").slice(0, 80) || upload.id
        const respond = (vtt: string, cache: string, suffix = "") =>
          withCors(
            new Response(srt ? vttToSrt(vtt) : vtt, {
              headers: srt
                ? { "content-type": "application/x-subrip; charset=utf-8", "content-disposition": `attachment; filename="${name}${suffix}.srt"`, "cache-control": "private, max-age=60" }
                : { "content-type": "text/vtt; charset=utf-8", "cache-control": cache },
            }),
          )
        if (query.has("languages")) return json({ languages: await translatedLanguages(upload) })
        const language = query.get("lang")
        if (language) {
          if (!(Object.hasOwn(CAPTION_LANGUAGES, language))) return json({ error: "Unknown language" }, 400)
          const translated = await captionTranslation(upload, language)
          if (!translated) return withCors(new Response("Not generated yet", { status: 404 }))
          return respond(await translated.text(), "private, max-age=60", `.${language}`)
        }
        const object = await env.BUCKET.get(upload.transcriptKey)
        if (!object) {
          return withCors(new Response("Not found", { status: 404 }))
        }

        const transcript = parseTranscript(await object.json())
        if (!transcript) {
          return withCors(new Response("Not found", { status: 404 }))
        }

        return respond(transcriptToVtt(transcript), "public, max-age=31536000, immutable")
      },
      POST: ({ request, params }) => userApi(request, async (user) => {
        const upload = await ownedUpload(params.id, user)
        if (!upload) return json({ error: "Not found" }, 404)
        const body = await request.json().catch(() => null) as { language?: string } | null
        if (!body?.language || !(Object.hasOwn(CAPTION_LANGUAGES, body.language))) return json({ error: "Unknown language" }, 400)
        if (!(await allow(`translation:${user.sub}`, 10, 3600))) return json({ error: "Translation limit reached. Try again in an hour." }, 429)
        try {
          await translateCaptions(upload, body.language)
          return json({ ok: true })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Translation failed" }, 502)
        }
      }),
      OPTIONS: () => optionsResponse(),
    },
  },
})
