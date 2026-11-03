import { createFileRoute } from "@tanstack/react-router"
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { db } from "@/db"
import { uploads } from "@/db/schema"
import { isIndexable, isoDate } from "@/lib/seo"

const escape = (value: string) => value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string)

/** Google video sitemap of the videos their owners opted in to search. */
export const Route = createFileRoute("/sitemap-videos.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin
        const rows = await db
          .select()
          .from(uploads)
          .where(and(eq(uploads.searchIndexing, true), eq(uploads.visibility, "link"), eq(uploads.mediaType, "video"), isNull(uploads.passwordHash), isNull(uploads.deletedAt), isNotNull(uploads.posterKey)))
          .orderBy(desc(uploads.createdAt))
          .limit(5000)
        const entries = rows.filter(isIndexable).map((upload) => {
          const title = upload.title?.trim() || "Untitled video"
          const description = (upload.summary?.trim() || title).slice(0, 2048)
          return [
            "  <url>",
            `    <loc>${origin}/${upload.id}</loc>`,
            "    <video:video>",
            `      <video:thumbnail_loc>${origin}/api/poster/${upload.id}</video:thumbnail_loc>`,
            `      <video:title>${escape(title.slice(0, 100))}</video:title>`,
            `      <video:description>${escape(description)}</video:description>`,
            `      <video:content_loc>${origin}/api/media/${upload.id}</video:content_loc>`,
            `      <video:player_loc>${origin}/embed/${upload.id}</video:player_loc>`,
            ...(upload.duration ? [`      <video:duration>${Math.max(1, Math.round(upload.duration))}</video:duration>`] : []),
            `      <video:publication_date>${escape(isoDate(upload.createdAt))}</video:publication_date>`,
            "    </video:video>",
            "  </url>",
          ].join("\n")
        })
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${entries.join("\n")}\n</urlset>\n`
        return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } })
      },
    },
  },
})
