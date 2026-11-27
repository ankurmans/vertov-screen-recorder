import { lifecycleTick, lifecycleUnsubscribe } from "@/lib/lifecycle.server"
import { sendVideoNotification } from "@/lib/notifications.server"
import { Container } from "@cloudflare/containers"
import { allow, clientIp, sweepGuests } from "@/lib/rate-limit.server"
import handler from "@tanstack/react-start/server-entry"
import type { OutboundHandlerContext } from "@cloudflare/containers"
import { processFetch } from "@/lib/agent.server"
import { ContainerBusyError, busyRetryDelay, processExport, stepExport } from "@/lib/export.server"
import type { ExportRun } from "@/lib/export.server"
import { processImport } from "@/lib/import.server"
import { processRecording } from "@/lib/process.server"
import { rewriteAiText } from "@/lib/ai-text.server"
import { processStitch } from "@/lib/stitch.server"
import { processViewerCopy, stepViewerCopy, sweepViewerCopies } from "@/lib/viewer-copy.server"
import type { CopyRun } from "@/lib/viewer-copy.server"
import type { StitchState } from "@/lib/stitch.server"
import { handleViewerEvents } from "@/lib/viewer-events.server"
import type { ViewerEvent } from "@/lib/viewer-events.server"
import { processPoster, sweepPosters } from "@/lib/poster.server"
import { runRetention } from "@/lib/retention.server"
import { sweepOAuth } from "@/lib/oauth.server"
import { blockFraming } from "@/lib/extension-connect"
import { parseRefCode, refCookie } from "@/lib/referral-code"
import { reportError, sendErrorDigest } from "@/lib/error-report.server"

export type ProcessMessage =
  | { id: string; kind: "notification" }
  | { id: string; kind?: "process" }
  | { id: string; kind: "rewrite"; token: string; attempt?: number }
  | { id: string; kind: "export"; origin?: string }
  | { id: string; kind: "export-step"; run: ExportRun }
  | { id: string; kind: "viewer-copy" }
  | { id: string; kind: "viewer-copy-step"; run: CopyRun }
  | { id: string; kind: "import"; loomId: string }
  | { id: string; kind: "fetch"; url: string }
  | ({ id: string; kind: "stitch"; sources: Array<string> } & StitchState)
  | { id: string; kind: "poster"; force?: boolean; mode?: "fill" | "refresh" | "force" }

// Required for the container's outbound requests to reach the handlers below.
export { ContainerProxy } from "@cloudflare/containers"
export { RecordingPartStore } from "@/lib/recording-parts.server"

/**
 * ffmpeg in a container, for MP4 exports with the layout baked in. It has no
 * internet; its reads of http://media.internal/<key> are served from R2 here.
 */
export class Exporter extends Container {
  defaultPort = 8080
  sleepAfter = "2m"
  enableInternet = false
  private unanswered = 0
  // The server runs as PID 1 with no SIGTERM handler, so the default stop() is ignored and idle instances hold the instance cap.
  override async onActivityExpired() {
    // A background render sends nothing between the Worker's looks at it, so ask before shutting the instance down.
    if (await this.holdingJob()) return
    await this.destroy()
  }
  /** A busy instance may be slow to answer, so only the third silence in a row counts as idle. */
  private async holdingJob() {
    try {
      const response = await this.containerFetch("http://exporter/busy")
      this.unanswered = 0
      return response.ok && ((await response.json()) as { holding?: boolean }).holding === true
    } catch {
      return ++this.unanswered < 3
    }
  }
}

// Assigned, not declared as a static field: a field would shadow the base class's registering setter.
Exporter.outboundByHost = {
  "media.internal": async (request: Request, env: unknown, _ctx: OutboundHandlerContext) => {
    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.slice(1))
    if (!key.startsWith("uploads/")) return new Response("Not found", { status: 404 })
    // ?bytes=N serves only the first N bytes (poster jobs; see POSTER_LIMITS), so a huge file isn't copied whole.
    const cap = Number(url.searchParams.get("bytes"))
    const limited = Number.isSafeInteger(cap) && cap > 0
    const object = await (env as Env).BUCKET.get(key, limited ? { range: { offset: 0, length: cap } } : undefined)
    if (!object) return new Response("Not found", { status: 404 })
    return new Response(object.body, { headers: { "content-length": String(limited ? Math.min(object.size, cap) : object.size) } })
  },
}

/** A page opened from a friend's `?ref=` link remembers the code for 30 days; the friend's first workspace reads it. Hosted only. */
function withReferralCookie(request: Request, env: Env, response: Response): Response {
  if (request.method !== "GET" || Reflect.get(env, "HOSTED") !== "1" || response.status !== 200 || !response.headers.get("content-type")?.startsWith("text/html")) return response
  const url = new URL(request.url)
  const code = parseRefCode(url.searchParams.get("ref"))
  if (!code) return response
  const headers = new Headers(response.headers)
  headers.append("set-cookie", refCookie(code, url.protocol === "https:"))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const worker = {
  fetch: async (request, env) => {
    const url = new URL(request.url)
    if (url.pathname === "/email/stop") return lifecycleUnsubscribe(request, env.DB)
    if (url.pathname === "/connect-extension") {
      // The consent screen must never be framed (clickjacking): it hands out access on one click.
      return blockFraming(await handler.fetch(request))
    }
    if (request.method === "POST" && url.pathname === "/api/auth/sign-in/anonymous") {
      // Guest accounts are free to make, so cap how many one address can open per hour.
      if (!(await allow(`guest:${clientIp(request)}`, 10, 3600))) {
        return Response.json({ error: "Too many new guests from this network. Try again in an hour." }, { status: 429 })
      }
    }
    return handler.fetch(request)
  },
  async queue(batch: MessageBatch<ProcessMessage | ViewerEvent>) {
    // vertov-events (and vertov-events-eu) carry viewer pings; every other queue carries jobs.
    if (batch.queue.startsWith("vertov-events")) return handleViewerEvents(batch as MessageBatch<ViewerEvent>)
    for (const message of (batch as MessageBatch<ProcessMessage>).messages) {
      const body = message.body
      try {
        if (body.kind === "notification") await sendVideoNotification(body.id)
        else if (body.kind === "export") await processExport(body.id)
        else if (body.kind === "rewrite") await rewriteAiText(body.id, body.token, body.attempt)
        else if (body.kind === "export-step") await stepExport(body.id, body.run, message.attempts)
        else if (body.kind === "viewer-copy") await processViewerCopy(body.id)
        else if (body.kind === "viewer-copy-step") await stepViewerCopy(body.id, body.run, message.attempts)
        else if (body.kind === "import") await processImport(body.id, body.loomId)
        else if (body.kind === "fetch") await processFetch(body.id, body.url, message.attempts)
        else if (body.kind === "stitch") await processStitch(body.id, body.sources, body, message.attempts)
            else if (body.kind === "poster") await processPoster(body.id, body.mode ?? (body.force ? "force" : "fill"))
        else await processRecording(body.id)
      } catch (error) {
        // Every container was busy: the job is still pending, so put it back in the queue instead of failing it.
        if (!(error instanceof ContainerBusyError)) {
          await reportError(error, { source: "queue", route: body.kind ?? "process", uploadId: body.id })
          throw error
        }
        message.retry({ delaySeconds: busyRetryDelay(message.attempts) })
        continue
      }
      message.ack()
    }
  },
  async scheduled(controller, env) {
    if (controller.cron !== "17 9 * * *") {
      // A failure here must not keep the lifecycle email from going out.
      await sweepViewerCopies().catch((error: unknown) => reportError(error, { source: "cron", route: "viewer-copies" }))
      console.log(JSON.stringify({ message: "Lifecycle run", ...(await lifecycleTick(env)) }))
      return
    }
    try {
      console.log(JSON.stringify({ message: "Retention run", ...(await runRetention()) }))
      console.log(JSON.stringify({ message: "Guest sweep", ...(await sweepGuests()) }))
      console.log(JSON.stringify({ message: "Poster sweep", ...(await sweepPosters()) }))
      await sweepOAuth()
    } catch (error) {
      await reportError(error, { source: "cron", route: "daily" })
      throw error
    }
    console.log(JSON.stringify({ message: "Error digest", ...(await sendErrorDigest().catch(() => ({ open: 0, sent: false }))) }))
  },
} satisfies ExportedHandler<Env, ProcessMessage | ViewerEvent>

export default {
  ...worker,
  fetch: async (request, env) => {
    try {
      return withReferralCookie(request, env, await worker.fetch(request, env))
    } catch (error) {
      // Anything that escapes the app shell becomes a 500 for the visitor and a report for the owner.
      await reportError(error, { source: "fetch", route: new URL(request.url).pathname })
      throw error
    }
  },
} satisfies ExportedHandler<Env, ProcessMessage | ViewerEvent>
