import type { SidebarData } from "@/components/library-sidebar"
import type { Workspace } from "@/db/schema"
import { listSpaces } from "@/lib/library.server"
import { canManage } from "@/lib/plans"
import type { Role } from "@/lib/plans"

/** What the library sidebar needs on pages other than the library itself. */
export async function sidebarData(workspace: Workspace, role: Role): Promise<SidebarData> {
  const spaces = await listSpaces(workspace.id)
  return {
    spaces: spaces.map((space) => ({ id: space.id, name: space.name })),
    manage: canManage(role),
  }
}
