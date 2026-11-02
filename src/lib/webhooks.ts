import { and, desc, eq, isNull } from "drizzle-orm"
import { waitUntil } from "cloudflare:workers"
import { db } from "@/db"
import { webhookDeliveries, webhookEndpoints } from "@/db/schema"

export const WEBHOOK_EVENTS = ["video.ready", "video.viewed", "comment.created"] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const isWebhookEvent = (value: string): value is WebhookEvent => (WEBHOOK_EVENTS as ReadonlyArray<string>).includes(value)

const MAX_ENDPOINTS = 10
export const maxEndpoints = () => MAX_ENDPOINTS

/** True for hostnames that point at the machine itself or a private network. Literal addresses only: DNS is Cloudflare's to guard. */
function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local") || name.endsWith(".internal")) return true
  if (name.includes(":")) {
    return name === "::1" || name === "::" || /^f[cd]/.test(name) || /^fe[89ab]/.test(name) || name.startsWith("::ffff:")
  }
  const parts = name.split(".")
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const [a, b] = parts.map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  // A bare number or hex form of an address ("2130706433", "0x7f000001") is still an address.
  return /^(0x[0-9a-f]+|\d+)$/.test(name) || !name.includes(".")
}

/** Returns a normalised https URL, or null when it isn't safe to call. */
export function safeWebhookUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null
    if (isPrivateHost(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

export function newWebhookSecret(): string {
  return `whsec_${toBase64(crypto.getRandomValues(new Uint8Array(24)))}`
}

/** Standard Webhooks signature: base64 HMAC-SHA256 of "id.timestamp.body" with the decoded secret. */
export async function signWebhook(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret
  const keyBytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0))
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  return `v1,${toBase64(new Uint8Array(signature))}`
}

async function deliver(endpoint: { id: string; url: string; secret: string }, event: WebhookEvent, data: unknown): Promise<void> {
  const deliveryId = crypto.randomUUID()
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify({ type: event, timestamp: new Date(timestamp * 1000).toISOString(), data })
  const id = `msg_${deliveryId.replaceAll("-", "")}`
  let status: number | null = null
  let error: string | null = null
  try {
    if (!safeWebhookUrl(endpoint.url)) throw new Error("URL is not allowed")
    const response = await fetch(endpoint.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vertov-Webhooks/1",
        "webhook-id": id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": await signWebhook(endpoint.secret, id, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    })
    status = response.status
    if (!response.ok) error = `Responded ${response.status}`
  } catch (failure) {
    error = failure instanceof Error ? failure.message.slice(0, 200) : "Request failed"
  }
  await db.insert(webhookDeliveries).values({ id: deliveryId, endpointId: endpoint.id, event, status, error }).catch(() => {})
}

/**
 * Sends an event to every live endpoint of the workspace that subscribed to it. Runs after the response
 * (waitUntil) so a slow receiver never delays the action; failures are logged, never thrown.
 */
export function emitWebhook(workspaceId: string | null | undefined, event: WebhookEvent, data: unknown): void {
  if (!workspaceId) return
  const work = (async () => {
    const endpoints = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.workspaceId, workspaceId), isNull(webhookEndpoints.disabledAt)))
    await Promise.all(endpoints.filter((endpoint) => endpoint.events.split(",").includes(event)).map((endpoint) => deliver(endpoint, event, data)))
  })().catch(() => {})
  try {
    waitUntil(work)
  } catch {
    // Outside a request (tests): the promise still runs.
  }
}

export function listWebhookEndpoints(workspaceId: string) {
  return db
    .select({ id: webhookEndpoints.id, url: webhookEndpoints.url, events: webhookEndpoints.events, createdAt: webhookEndpoints.createdAt })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.workspaceId, workspaceId), isNull(webhookEndpoints.disabledAt)))
    .orderBy(desc(webhookEndpoints.createdAt))
}

export async function recentDeliveries(endpointId: string) {
  return db
    .select({ event: webhookDeliveries.event, status: webhookDeliveries.status, error: webhookDeliveries.error, createdAt: webhookDeliveries.createdAt })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(10)
}

