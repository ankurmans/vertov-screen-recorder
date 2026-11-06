import { createFileRoute } from "@tanstack/react-router"
import { optionsResponse } from "@/lib/api.server"
import { serveMedia } from "@/lib/media-response.server"

export const Route = createFileRoute("/api/voiceover/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => serveMedia(params.id, request, "voice"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
