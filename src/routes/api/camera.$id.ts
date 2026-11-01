import { createFileRoute } from "@tanstack/react-router"
import { optionsResponse } from "@/lib/api.server"
import { serveMedia } from "@/lib/media-response.server"

export const Route = createFileRoute("/api/camera/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => serveMedia(params.id, request, "camera"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
