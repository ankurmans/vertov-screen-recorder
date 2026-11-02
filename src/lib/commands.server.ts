import type { SessionUser } from "@/lib/auth.server"
import type { WorkspaceContext } from "@/lib/workspace.server"
import { listLibrary, listSpaces } from "@/lib/library.server"

export async function commandResults(user: SessionUser, context: WorkspaceContext, query: string) {
  const [videos, spaces] = await Promise.all([
    listLibrary(context.workspace.id, user.sub, { kind: "search", query }, 8),
    listSpaces(context.workspace.id),
  ])
  return {
    videos: videos.map((video) => ({
      id: video.id,
      title: video.title || "Untitled recording",
      snippet: video.snippet,
      duration: video.duration,
    })),
    spaces: spaces
      .filter((space) => !query || space.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 6)
      .map((space) => ({ id: space.id, name: space.name })),
  }
}
