import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { createVideoFromBody, createVideoFromUrl, videoContainer, videoForAgent } from "@/lib/agent.server"
import { json, optionsResponse } from "@/lib/api.server"
import { listLibrary, spaceInWorkspace } from "@/lib/library.server"
import { getUploadById } from "@/lib/uploads.server"
import { libraryFullMessage } from "@/lib/workspace.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const urlSchema = z.object({
  url: z.url().refine((value) => value.startsWith("https://"), "Use an https URL"),
  title: z.string().trim().min(1).max(200).nullable().optional(),
  spaceId: z.string().max(64).nullable().optional(),
  // The Loom share link this copy replaces (the extension's private-Loom import), for old-link redirects.
  sourceUrl: z
    .string()
    .regex(/^https:\/\/www\.loom\.com\/share\/[a-f0-9]{32}$/)
    .nullable()
    .optional(),
})

/**
 * Agent and script API (Authorization: Bearer rk_...).
 * GET lists or searches (?q=) the workspace's videos you can see.
 * POST with a video body (Content-Type video/mp4 or video/webm, ?title=&duration=&spaceId=) stores it and returns the share link.
 * POST with JSON {url, title?} copies a public video in the background and returns the link right away.
 */
export const Route = createFileRoute("/api/v1/videos")({
  server: {
    handlers: {
      GET: ({ request }) =>
        workspaceApi(request, async (user, { workspace }) => {
          const query = new URL(request.url).searchParams.get("q")?.trim()
          const items = await listLibrary(workspace.id, user.sub, query ? { kind: "search", query } : { kind: "mine", folderId: null })
          const origin = new URL(request.url).origin
          return json({
            videos: items.map((video) => ({
              id: video.id,
              url: `${origin}/${video.id}`,
              title: video.title,
              duration: video.duration,
              status: video.status,
              createdAt: video.createdAt,
              owner: video.ownerName,
              snippet: video.snippet,
            })),
          })
        }),
      POST: ({ request }) =>
        workspaceApi(request, async (user, { workspace }) => {
          const full = await libraryFullMessage(workspace)
          if (full) return json({ error: full, code: "library_full" }, 402)
          const origin = new URL(request.url).origin
          const contentType = request.headers.get("content-type") ?? ""

          if (contentType.startsWith("application/json")) {
            const parsed = urlSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success) return json({ error: "Send {\"url\": \"https://…\"} or the video itself as the body" }, 400)
            const spaceId = parsed.data.spaceId ?? null
            if (spaceId && !(await spaceInWorkspace(spaceId, workspace.id))) return json({ error: "Unknown space" }, 400)
            const upload = await createVideoFromUrl(user, workspace, parsed.data.url, { title: parsed.data.title ?? null, spaceId, sourceUrl: parsed.data.sourceUrl ?? null })
            return json(await videoForAgent(upload, origin, false), 202)
          }

          const container = videoContainer(contentType)
          if (!container || !request.body) return json({ error: "Send an MP4 or WebM body with its Content-Type, or JSON with a url" }, 415)
          const search = new URL(request.url).searchParams
          const spaceId = search.get("spaceId")
          if (spaceId && !(await spaceInWorkspace(spaceId, workspace.id))) return json({ error: "Unknown space" }, 400)
          const duration = Number(search.get("duration"))
          const upload = await createVideoFromBody(user, workspace, request.body, container, {
            title: search.get("title")?.trim().slice(0, 200) || null,
            duration: Number.isFinite(duration) && duration > 0 ? duration : null,
            spaceId,
          })
          return json(await videoForAgent((await getUploadById(upload.id)) ?? upload, origin, false), 201)
        }),
      OPTIONS: () => optionsResponse(),
    },
  },
})
