import { z } from "zod"
import type { SessionUser } from "@/lib/auth.server"
import type { WorkspaceContext } from "@/lib/workspace.server"
import { db } from "@/db"
import { comments } from "@/db/schema"
import { agentPrompt, createVideoFromUrl, memberCanSee, videoForAgent } from "@/lib/agent.server"
import { APP_NAME } from "@/lib/brand"
import { listLibrary, listSpaces, spaceInWorkspace } from "@/lib/library.server"
import { getUploadById } from "@/lib/uploads.server"
import { libraryFullMessage } from "@/lib/workspace.server"

/**
 * A stateless MCP server (Streamable HTTP, JSON responses) over the same API keys as /api/v1.
 * Agents record with whatever they already have (Playwright, a CDP screencast, ffmpeg) and use
 * these tools to turn the file into a share link, or to read videos people recorded for them.
 */

const PROTOCOL = "2025-06-18"

interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const idInput = {
  type: "object",
  properties: { video: { type: "string", description: "The video's share link or its 8-character id." } },
  required: ["video"],
}

const TOOLS: Array<Tool> = [
  {
    name: "upload_video",
    description:
      "How to upload a local video file (MP4 or WebM) you recorded, e.g. with Playwright's recordVideo, a CDP screencast or ffmpeg. Returns a ready-to-run curl command; its JSON response contains the share link. Prefer this over describing a screen in words.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the video file on your machine." },
        title: { type: "string", description: "Title shown on the share page." },
      },
      required: ["path"],
    },
  },
  {
    name: "create_video_from_url",
    description: "Store a video that is already at a public https URL and get its share link immediately; the copy, transcript and summary finish in the background.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        space_id: { type: "string", description: "Optional space to put it in (see list_spaces)." },
      },
      required: ["url"],
    },
  },
  {
    name: "list_videos",
    description: "List your recent videos, or search titles, summaries and what was said in every video you can see.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "get_video",
    description: "A video's title, status, summary, chapters and full timestamped transcript.",
    inputSchema: idInput,
  },
  {
    name: "get_video_prompt",
    description:
      "The video as a Markdown brief for acting on it: what the person showed and said, in order, with timestamps. Use this when someone sends you a recording of what they want done.",
    inputSchema: idInput,
  },
  {
    name: "add_comment",
    description: "Leave a comment on a video, optionally pinned to a moment, e.g. to report back on what you did.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string" },
        text: { type: "string" },
        timestamp: { type: "number", description: "Seconds into the video." },
      },
      required: ["video", "text"],
    },
  },
  {
    name: "list_spaces",
    description: "The shared spaces in this workspace.",
    inputSchema: { type: "object", properties: {} },
  },
]

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

const text = (value: string) => ({ content: [{ type: "text", text: value }] })
const fail = (message: string) => ({ content: [{ type: "text", text: message }], isError: true })

function videoId(input: unknown): string | null {
  const raw = typeof input === "string" ? input.trim() : ""
  return /([a-f0-9]{8})(?:[/?#]|$)/.exec(raw)?.[1] ?? null
}

async function callTool(name: string, args: Record<string, unknown>, user: SessionUser, context: WorkspaceContext, origin: string) {
  const { workspace, role } = context
  switch (name) {
    case "upload_video": {
      const path = typeof args.path === "string" ? args.path : "recording.mp4"
      const title = typeof args.title === "string" ? args.title : ""
      const type = path.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4"
      const query = title ? `?title=${encodeURIComponent(title)}` : ""
      return text(
        [
          "Run this (it reuses the API key this MCP client already sends):",
          "",
          `curl -sS -X POST '${origin}/api/v1/videos${query}' \\`,
          `  -H "Authorization: Bearer $${APP_NAME.toUpperCase()}_API_KEY" \\`,
          `  -H 'Content-Type: ${type}' \\`,
          `  --data-binary @'${path.replace(/'/g, "'\\''")}'`,
          "",
          "The response is JSON with `url`, the share link. Bodies up to about 100 MB; for bigger files host them somewhere and use create_video_from_url.",
        ].join("\n"),
      )
    }
    case "create_video_from_url": {
      const parsed = z
        .object({ url: z.url().refine((value) => value.startsWith("https://")), title: z.string().max(200).optional(), space_id: z.string().max(64).optional() })
        .safeParse(args)
      if (!parsed.success) return fail("Give an https url.")
      const full = await libraryFullMessage(workspace)
      if (full) return fail(full)
      if (parsed.data.space_id && !(await spaceInWorkspace(parsed.data.space_id, workspace.id))) return fail("Unknown space.")
      const upload = await createVideoFromUrl(user, workspace, parsed.data.url, { title: parsed.data.title ?? null, spaceId: parsed.data.space_id ?? null })
      return text(JSON.stringify(await videoForAgent(upload, origin, false), null, 2))
    }
    case "list_videos": {
      const query = typeof args.query === "string" ? args.query.trim() : ""
      const videos = await listLibrary(workspace.id, user.sub, query ? { kind: "search", query } : { kind: "mine", folderId: null })
      const lines = videos
        .slice(0, 50)
        .map((video) => `- ${video.title || "Untitled"} — ${origin}/${video.id} (${video.duration ? `${Math.round(video.duration)}s, ` : ""}${video.createdAt.slice(0, 10)})${video.snippet ? `\n  “${video.snippet}”` : ""}`)
      return text(lines.length ? lines.join("\n") : query ? `No video mentions “${query}”.` : "No videos yet.")
    }
    case "get_video":
    case "get_video_prompt": {
      const id = videoId(args.video)
      const upload = id ? await getUploadById(id) : null
      if (!upload || !memberCanSee(upload, user, workspace.id, role)) return fail("Video not found in this workspace.")
      if (name === "get_video_prompt") return text(await agentPrompt(upload, origin))
      return text(JSON.stringify(await videoForAgent(upload, origin, true), null, 2))
    }
    case "add_comment": {
      const id = videoId(args.video)
      const upload = id ? await getUploadById(id) : null
      if (!upload || !memberCanSee(upload, user, workspace.id, role)) return fail("Video not found in this workspace.")
      if (!upload.socialEnabled) return fail("Comments are turned off on this video.")
      const body = typeof args.text === "string" ? args.text.trim().slice(0, 2000) : ""
      if (!body) return fail("Write some text.")
      const timestamp = typeof args.timestamp === "number" && args.timestamp >= 0 ? args.timestamp : null
      await db.insert(comments).values({
        id: crypto.randomUUID(),
        uploadId: upload.id,
        viewerId: user.sub,
        authorName: user.name,
        authorAvatar: user.avatar,
        text: body,
        timestamp,
      })
      return text(`Comment added: ${origin}/${upload.id}${timestamp != null ? `?t=${Math.floor(timestamp)}` : ""}`)
    }
    case "list_spaces": {
      const spaces = await listSpaces(workspace.id)
      return text(spaces.length ? spaces.map((space) => `- ${space.name} (id: ${space.id})`).join("\n") : "No spaces yet.")
    }
    default:
      return null
  }
}

/** Handles one JSON-RPC message; null means it was a notification and needs no reply. */
export async function handleRpc(message: RpcRequest, user: SessionUser, context: WorkspaceContext, origin: string): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result })
  const error = (code: number, detail: string) => ({ jsonrpc: "2.0", id, error: { code, message: detail } })
  if (message.id === undefined) return null
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: APP_NAME.toLowerCase(), version: "1.0.0" },
        instructions: `${APP_NAME} turns screen recordings into share links with transcripts. Workspace: ${context.workspace.name}. To show a person what you did, record it (Playwright recordVideo, a CDP screencast or ffmpeg) and use upload_video. When a person sends you a ${APP_NAME} link, call get_video_prompt to read it.`,
      })
    case "ping":
      return reply({})
    case "tools/list":
      return reply({ tools: TOOLS })
    case "tools/call": {
      const name = message.params?.name ?? ""
      const result = await callTool(name, message.params?.arguments ?? {}, user, context, origin)
      return result ? reply(result) : error(-32602, `Unknown tool: ${name}`)
    }
    default:
      return error(-32601, `Method not found: ${message.method ?? ""}`)
  }
}
