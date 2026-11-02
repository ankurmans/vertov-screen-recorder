import { createFileRoute } from "@tanstack/react-router"
import { videoInsightsResponse } from "@/lib/analytics.server"
import { userApi } from "@/lib/recordings.server"

export const Route = createFileRoute("/api/insights/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => userApi(request, (user) => videoInsightsResponse(request, params.id, user)),
    },
  },
})
