import { createFileRoute } from "@tanstack/react-router"
import { getAuth } from "@/lib/auth.server"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => getAuth(request).handler(request),
      POST: ({ request }) => getAuth(request).handler(request),
    },
  },
})
