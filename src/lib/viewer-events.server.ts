import { env } from "cloudflare:workers"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { uploads, viewEvents, viewProgress } from "@/db/schema"
import { eventsBinding, eventsDb } from "@/lib/events-db.server"
import { HOSTED_EDITION } from "@/lib/edition"
import { rowCap } from "@/lib/ping-limits"
import { SHARE_COUNTER_KEY, countAppEvent } from "@/lib/activation-events.server"
import { noteLifecycleEvent } from "@/lib/lifecycle-events.server"
import { recordNotification } from "@/lib/notifications.server"
import { captureServer } from "@/lib/posthog.server"
import { deliverWebhooks } from "@/lib/webhooks"

/**
 * Viewer pings (a view of a share page, a watch-progress update) are the busiest writes in the app: a viral video sends
 * thousands a second, and D1 is one single-threaded database. The endpoints check access, then hand the ping to a queue
 * (EVENT_QUEUE, hosted only); the queue consumer applies a whole batch in one D1 round trip, adding each video's views
 * in one update and keeping only each viewer's furthest progress. Without the binding (self-hosting, local dev) or when
 * the queue refuses a message, the ping is applied right away as a batch of one.
 *
 * The detail rows (view_events, view_progress) go to the events database (events-db.server.ts); only the counters on the
 * upload stay on the main one. Detail rows are capped per video by plan (ping-limits.ts); the counters never are.
 */
export interface ViewMessage {
  kind: "view"
  /** Makes a redelivered batch write each row once. Messages queued before this field existed have none. */
  id?: string
  uploadId: string
  /** ISO time of the ping. */
  at: string
  ownerId: string | null
  workspaceId: string | null
  title: string | null
  mediaType: string
  ready: boolean
  /** The signed-in viewer, when there is one. */
  viewer: string | null
  referrer: string | null
  country: string | null
  city: string | null
  device: string | null
  origin: string
  /** The video's workspace is on the Free plan, which keeps fewer detail rows. Absent on older messages. */
  free?: boolean
}

export interface ProgressMessage {
  kind: "progress"
  uploadId: string
  workspaceId?: string | null
  free?: boolean
  viewerKey: string
  viewerName: string | null
  viewerAvatar: string | null
  percent: number
  seconds: number
  country: string | null
  city: string | null
}

export type ViewerEvent = ViewMessage | ProgressMessage

const eventQueue = () => (env as unknown as { EVENT_QUEUE?: Queue<ViewerEvent> }).EVENT_QUEUE

async function submit(event: ViewerEvent, apply: () => Promise<void>): Promise<void> {
  const queue = eventQueue()
  if (queue) {
    try {
      await queue.send(event)
      return
    } catch {
      console.warn("Viewer event queue unavailable; applying the ping now")
    }
  }
  await apply()
}

export const submitView = (message: ViewMessage) => {
  const withId = { ...message, id: message.id ?? crypto.randomUUID() }
  return submit(withId, () => applyViews([withId]))
}
export const submitProgress = (message: ProgressMessage) => submit(message, () => applyProgress([message]))

const chunks = <T>(items: Array<T>, size: number): Array<Array<T>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, at) => items.slice(at * size, at * size + size))

/** SQLite's `datetime('now')` form, which the view tables' timestamps use. */
const sqlTime = (iso: string) => (Number.isNaN(Date.parse(iso)) ? new Date() : new Date(iso)).toISOString().slice(0, 19).replace("T", " ")

/** Views each upload already has, for the uploads in this batch that still exist (a deleted video's late pings are dropped). */
async function existingViews(ids: Array<string>, agentMade?: Set<string>): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  for (const part of chunks(ids, 90)) {
    for (const row of await db.select({ id: uploads.id, views: uploads.views, surface: uploads.captureSurface }).from(uploads).where(inArray(uploads.id, part))) {
      found.set(row.id, row.views)
      if (row.surface === "agent") agentMade?.add(row.id)
    }
  }
  return found
}

/** Detail rows each upload already has in the events database, to hold Free workspaces to their per-video cap. */
async function rowCounts(table: "view_events" | "view_progress", ids: Array<string>): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  if (!HOSTED_EDITION) return found
  for (const part of chunks(ids, 90)) {
    const marks = part.map(() => "?").join(",")
    const { results } = await eventsBinding().prepare(`SELECT upload_id AS id, count(*) AS n FROM ${table} WHERE upload_id IN (${marks}) GROUP BY upload_id`).bind(...part).all<{ id: string; n: number }>()
    for (const row of results) found.set(row.id, row.n)
  }
  return found
}

const roomFor = (free: boolean | undefined, held: number | undefined) => (HOSTED_EDITION ? Math.max(0, rowCap(free === true) - (held ?? 0)) : Number.POSITIVE_INFINITY)

/**
 * Adds a batch of views: detail rows into the events database (idempotent, so a retried batch writes each once), then one
 * atomic D1 batch for the counters, then (best effort, once per video) the first-view counter, the owner's lifecycle
 * milestone and notification, and a webhook for every view.
 */
export async function applyViews(batch: Array<ViewMessage>): Promise<void> {
  if (batch.length === 0) return
  const agentMade = new Set<string>()
  const before = await existingViews([...new Set(batch.map((message) => message.uploadId))], agentMade)
  const messages = batch.filter((message) => before.has(message.uploadId))
  if (messages.length === 0) return
  const byUpload = new Map<string, Array<ViewMessage>>()
  for (const message of messages) byUpload.set(message.uploadId, [...(byUpload.get(message.uploadId) ?? []), message])

  const held = await rowCounts("view_events", [...byUpload.keys()])
  const detail: Array<ViewMessage> = []
  for (const [id, sent] of byUpload) detail.push(...sent.slice(0, roomFor(sent[0].free, held.get(id))))
  const events = eventsDb()
  const eventWrites = []
  // view_events has eight columns, and a statement may bind at most 100 values.
  for (const part of chunks(detail, 10)) {
    eventWrites.push(
      events
        .insert(viewEvents)
        .values(
          part.map((message) => ({
            id: message.id ?? crypto.randomUUID(),
            uploadId: message.uploadId,
            workspaceId: message.workspaceId,
            country: message.country,
            city: message.city,
            referrer: message.referrer,
            device: message.device,
            createdAt: sqlTime(message.at),
          })),
        )
        .onConflictDoNothing(),
    )
  }
  for (const part of chunks(eventWrites, 50)) await events.batch(part as unknown as [(typeof eventWrites)[number], ...Array<(typeof eventWrites)[number]>])

  const writes = []
  for (const [id, sent] of byUpload) {
    const latest = sent.map((message) => message.at).sort().at(-1)!
    writes.push(db.update(uploads).set({ views: sql`${uploads.views} + ${sent.length}`, lastViewedAt: latest, retentionNoticeAt: null, retentionFinalAt: null }).where(eq(uploads.id, id)))
  }
  for (const part of chunks(writes, 50)) await db.batch(part as unknown as [(typeof writes)[number], ...Array<(typeof writes)[number]>])

  for (const part of chunks([...byUpload], 10)) {
    await Promise.all(
      part.map(async ([id, sent]) => {
        const first = sent[0]
        try {
          // Someone other than the owner opened the link for the first time: the observable result of sharing a video.
          if (before.get(id) === 0) await countAppEvent({ key: SHARE_COUNTER_KEY, event: "first_external_view" })
          if (first.mediaType === "video" && first.ready) await noteLifecycleEvent(first.ownerId, "viewed")
          await recordNotification({ id, ownerId: first.ownerId }, "view", first.viewer ?? undefined)
          for (const message of sent) captureServer("video_viewed", message.ownerId, { first_view: before.get(id) === 0, agent_video: agentMade.has(id) })
          await deliverWebhooks(
            first.workspaceId,
            "video.viewed",
            sent.map((message) => ({ id, url: `${message.origin}/${id}`, title: message.title, country: message.country, referrer: message.referrer })),
          )
        } catch {
          console.warn("A view's follow-up work failed; the view was counted")
        }
      }),
    )
  }
}

/** Keeps each viewer's furthest progress in the batch and writes one upsert per viewer and video. */
export async function applyProgress(batch: Array<ProgressMessage>): Promise<void> {
  const ids = [...new Set(batch.map((message) => message.uploadId))]
  const alive = await existingViews(ids)
  const held = await rowCounts("view_progress", ids)
  // A Free video past its detail-row cap takes no more viewers' progress; its view counter is unaffected.
  const messages = batch.filter((message) => alive.has(message.uploadId))
  const merged = new Map<string, ProgressMessage>()
  for (const message of messages) {
    const key = `${message.uploadId}\u0000${message.viewerKey}`
    const held = merged.get(key)
    merged.set(
      key,
      held
        ? {
            ...message,
            percent: Math.max(held.percent, message.percent),
            seconds: Math.max(held.seconds, message.seconds),
            viewerName: message.viewerName ?? held.viewerName,
            viewerAvatar: message.viewerAvatar ?? held.viewerAvatar,
          }
        : message,
    )
  }
  const events = eventsDb()
  const room = new Map<string, number>()
  const kept: Array<ProgressMessage> = []
  for (const message of merged.values()) {
    const left = room.get(message.uploadId) ?? roomFor(message.free, held.get(message.uploadId))
    if (left <= 0) continue
    room.set(message.uploadId, left - 1)
    kept.push(message)
  }
  const writes = kept.map((message) =>
    events
      .insert(viewProgress)
      .values({
        uploadId: message.uploadId,
        workspaceId: message.workspaceId ?? null,
        viewerKey: message.viewerKey,
        viewerName: message.viewerName,
        viewerAvatar: message.viewerAvatar,
        percent: message.percent,
        seconds: message.seconds,
        country: message.country,
        city: message.city,
      })
      .onConflictDoUpdate({
        target: [viewProgress.uploadId, viewProgress.viewerKey],
        set: {
          percent: sql`max(${viewProgress.percent}, excluded.percent)`,
          seconds: sql`max(${viewProgress.seconds}, excluded.seconds)`,
          viewerName: sql`coalesce(excluded.viewer_name, ${viewProgress.viewerName})`,
          viewerAvatar: sql`coalesce(excluded.viewer_avatar, ${viewProgress.viewerAvatar})`,
          workspaceId: sql`coalesce(excluded.workspace_id, ${viewProgress.workspaceId})`,
          updatedAt: sql`datetime('now')`,
        },
      }),
  )
  for (const part of chunks(writes, 50)) await events.batch(part as unknown as [(typeof writes)[number], ...Array<(typeof writes)[number]>])
}

/** The queue consumer: applies a batch, acknowledging each kind only once its write has landed, and retrying it otherwise. */
export async function handleViewerEvents(batch: MessageBatch<ViewerEvent>): Promise<void> {
  const views = batch.messages.filter((message) => message.body.kind === "view")
  const progress = batch.messages.filter((message) => message.body.kind === "progress")
  const run = async (group: typeof views, apply: (bodies: Array<never>) => Promise<void>) => {
    if (group.length === 0) return
    try {
      await apply(group.map((message) => message.body) as Array<never>)
      for (const message of group) message.ack()
    } catch (error) {
      console.error(JSON.stringify({ message: "Viewer events failed", error: error instanceof Error ? error.message : String(error) }))
      for (const message of group) message.retry({ delaySeconds: 30 })
    }
  }
  await run(views, (bodies) => applyViews(bodies as Array<ViewMessage>))
  await run(progress, (bodies) => applyProgress(bodies as Array<ProgressMessage>))
}
