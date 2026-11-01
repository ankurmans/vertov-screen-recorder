import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workspaces } from "@/db/schema"
import type { Brand } from "@/lib/brand-theme"

/** A workspace's logo and accent color for its share pages; null when it has neither. */
export async function getBrand(workspaceId: string | null): Promise<Brand | null> {
  if (!workspaceId) return null
  const row = await db
    .select({ name: workspaces.name, color: workspaces.brandColor, logoKey: workspaces.brandLogoKey })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get()
  if (!row || (!row.color && !row.logoKey)) return null
  return {
    name: row.name,
    color: row.color,
    logo: row.logoKey ? `/api/brand/${workspaceId}?v=${encodeURIComponent(row.logoKey.split("-").pop() ?? "1")}` : null,
  }
}
