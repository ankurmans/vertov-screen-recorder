import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { apiKeys } from "@/db/schema"

/** A user's live API keys in one workspace, without the secret. */
export function listApiKeys(userId: string, workspaceId: string) {
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt))
}
