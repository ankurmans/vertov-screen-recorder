import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { denyUnlessViewable } from "@/lib/access.server"
import { optionsResponse, withCors } from "@/lib/api.server"
import { visibleTranscript } from "@/lib/cuts"
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
        // Edits change what these captions may say, so no copy is kept for long.
        const respond = (vtt: string, suffix = "") =>
          withCors(
            new Response(srt ? vttToSrt(vtt) : vtt, {
              headers: srt
                ? { "content-type": "application/x-subrip; charset=utf-8", "content-disposition": `attachment; filename="${name}${suffix}.srt"`, "cache-control": "private, max-age=60" }
                : { "content-type": "text/vtt; charset=utf-8", "cache-control": "private, max-age=60" },
            }),
          )
        const object = await env.BUCKET.get(upload.transcriptKey)
        if (!object) {
          return withCors(new Response("Not found", { status: 404 }))
        }

        const transcript = parseTranscript(await object.json())
        if (!transcript) {
          return withCors(new Response("Not found", { status: 404 }))
        }

        return respond(transcriptToVtt(visibleTranscript(transcript, upload) ?? { cues: [] }))
      },
      OPTIONS: () => optionsResponse(),
    },
  },
})
