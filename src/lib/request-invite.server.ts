// The invite on the "sent" screen offers hosted plans; this edition shows nothing there.
import type { RequestInviteData } from "@/lib/request-link"

export async function loadRequestInvite(_request: Request, _workspaceId: string): Promise<RequestInviteData | null> {
  return null
}
