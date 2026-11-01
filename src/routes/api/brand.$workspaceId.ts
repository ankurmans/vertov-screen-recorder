import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workspaces } from "@/db/schema"

/** A workspace's logo for its share pages. The URL carries a version, so it caches for a year. */
export const Route = createFileRoute("/api/brand/$workspaceId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const row = await db
          .select({ key: workspaces.brandLogoKey })
          .from(workspaces)
          .where(eq(workspaces.id, params.workspaceId))
          .get()
        if (!row?.key) return new Response("Not found", { status: 404 })
        const object = await env.BUCKET.get(row.key)
        if (!object) return new Response("Not found", { status: 404 })
        return new Response(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "image/png",
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
          },
        })
      },
    },
  },
})
