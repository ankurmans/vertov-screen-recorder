import { sendVideoNotification } from "@/lib/notifications.server"
import { Container } from "@cloudflare/containers"
import { allow, clientIp, sweepGuests } from "@/lib/rate-limit.server"
import handler from "@tanstack/react-start/server-entry"
import type { OutboundHandlerContext } from "@cloudflare/containers"
import { processFetch } from "@/lib/agent.server"
import { processExport } from "@/lib/export.server"
import { processImport } from "@/lib/import.server"
import { processRecording } from "@/lib/process.server"
import { processStitch } from "@/lib/stitch.server"
import { runRetention } from "@/lib/retention.server"

export type ProcessMessage =
  | { id: string; kind: "notification" }
  | { id: string; kind?: "process" }
  | { id: string; kind: "export"; origin: string }
  | { id: string; kind: "import"; loomId: string }
  | { id: string; kind: "fetch"; url: string }
  | { id: string; kind: "stitch"; sources: Array<string> }

// Required for the container's outbound requests to reach the handlers below.
export { ContainerProxy } from "@cloudflare/containers"

/**
 * ffmpeg in a container, for MP4 exports with the layout baked in. It has no
 * internet; its reads of http://media.internal/<key> are served from R2 here.
 */
export class Exporter extends Container {
  defaultPort = 8080
  sleepAfter = "2m"
  enableInternet = false
}

// Assigned, not declared as a static field: a field would shadow the base class's registering setter.
Exporter.outboundByHost = {
  "media.internal": async (request: Request, env: unknown, _ctx: OutboundHandlerContext) => {
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1))
    if (!key.startsWith("uploads/")) return new Response("Not found", { status: 404 })
    const object = await (env as Env).BUCKET.get(key)
    if (!object) return new Response("Not found", { status: 404 })
    return new Response(object.body, { headers: { "content-length": String(object.size) } })
  },
}

export default {
  fetch: async (request) => {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/api/auth/sign-in/anonymous") {
      // Guest accounts are free to make, so cap how many one address can open per hour.
      if (!(await allow(`guest:${clientIp(request)}`, 10, 3600))) {
        return Response.json({ error: "Too many new guests from this network. Try again in an hour." }, { status: 429 })
      }
    }
    return handler.fetch(request)
  },
  async queue(batch: MessageBatch<ProcessMessage>) {
    for (const message of batch.messages) {
      const body = message.body
      if (body.kind === "notification") await sendVideoNotification(body.id)
      else if (body.kind === "export") await processExport(body.id)
      else if (body.kind === "import") await processImport(body.id, body.loomId)
      else if (body.kind === "fetch") await processFetch(body.id, body.url)
      else if (body.kind === "stitch") await processStitch(body.id, body.sources)
      else await processRecording(body.id)
      message.ack()
    }
  },
  async scheduled() {
    console.log(JSON.stringify({ message: "Retention run", ...(await runRetention()) }))
    console.log(JSON.stringify({ message: "Guest sweep", ...(await sweepGuests()) }))
  },
} satisfies ExportedHandler<Env, ProcessMessage>
