import type { SidebarData } from "@/components/library-sidebar"
import type { Workspace } from "@/db/schema"
import { listSpaces } from "@/lib/library.server"
import { canManage } from "@/lib/plans"
import type { Role } from "@/lib/plans"
import { isHosted, usageOf } from "@/lib/workspace.server"

/** What the library sidebar needs on pages other than the library itself. */
export async function sidebarData(workspace: Workspace, role: Role): Promise<SidebarData> {
  const [spaces, usage] = await Promise.all([listSpaces(workspace.id), usageOf(workspace)])
  return {
    spaces: spaces.map((space) => ({ id: space.id, name: space.name })),
    manage: canManage(role),
    hosted: isHosted(),
    plan: workspace.plan,
    usage: { usedHours: usage.usedHours, limitHours: Number.isFinite(usage.limitHours) ? usage.limitHours : null },
  }
}
