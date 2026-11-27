import { drizzle } from "drizzle-orm/d1"
import { env } from "cloudflare:workers"
import * as schema from "@/db/schema"

/**
 * Where viewer events (view_events, view_progress) live. The hosted stacks bind a second D1 database, EVENTS_DB, so the
 * busiest append-only writes never queue behind sign-ins, library loads or uploads on the main one. Without the binding
 * (self-hosting, local dev before the events migration) the same tables in the main database are used, which is why both
 * carry the same columns and neither is ever joined to uploads: workspace_id is copied onto every row.
 */
export const eventsBinding = (): D1Database => (env as unknown as { EVENTS_DB?: D1Database }).EVENTS_DB ?? env.DB

export const eventsDb = () => drizzle(eventsBinding(), { schema })
