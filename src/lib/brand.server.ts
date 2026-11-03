import type { Brand } from "@/lib/brand-theme"

// Custom logos and accent colors on share pages are part of the hosted service and are not
// included in this edition. Share pages use the default look.

export async function getBrand(_workspaceId: string | null): Promise<Brand | null> {
  return null
}
