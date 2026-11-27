import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"

// The End of Explaining runs on FlockStack and is served here at /newsletter/the-end-of-explaining.
// This route forwards the path to FlockStack with the mount token (FLOCKSTACK_MOUNT_TOKEN, a Worker secret), and FlockStack
// answers with every link already under this path. See flockstack.io/docs/subfolder.
const UPSTREAM = "https://flockstack.io/archive/the-end-of-explaining"
const PREFIX = "/newsletter/the-end-of-explaining"
const HOP_HEADERS = ["host", "connection", "content-length", "transfer-encoding", "accept-encoding", "cookie"]
const READER_COOKIES = new Set(["fs_reader_the-end-of-explaining", "fs_reader_the-end-of-explaining_on"])

function newsletterCookies(cookie: string | null): string {
  return (cookie ?? "").split(";").map((part) => part.trim()).filter((part) => {
    const separator = part.indexOf("=")
    return separator > 0 && READER_COOKIES.has(part.slice(0, separator))
  }).join("; ")
}

async function forward({ request }: { request: Request }): Promise<Response> {
  const token = (env as { FLOCKSTACK_MOUNT_TOKEN?: string }).FLOCKSTACK_MOUNT_TOKEN
  if (!token) return new Response("Not found", { status: 404 })
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  for (const name of HOP_HEADERS) headers.delete(name)
  // FlockStack sets these on the mounted path. Vertov's own session must stay on Vertov.
  const readerCookies = newsletterCookies(request.headers.get("cookie"))
  if (readerCookies) headers.set("Cookie", readerCookies)
  headers.set("X-Forwarded-Host", url.host)
  headers.set("X-Forwarded-Proto", "https")
  headers.set("X-FlockStack-Mount", token)
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
  const answer = await fetch(`${UPSTREAM}${url.pathname.slice(PREFIX.length)}${url.search}`, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  })
  const out = new Headers(answer.headers)
  out.delete("content-encoding")
  out.delete("content-length")
  for (const name of [...out.keys()]) if (name.startsWith("x-nextjs-")) out.delete(name)
  // Build files are named by their content and keep FlockStack's long cache; pages and feeds change with each issue.
  if (!url.pathname.startsWith(`${PREFIX}/_next/static/`)) {
    const upstreamCache = out.get("Cache-Control") ?? ""
    const path = url.pathname.slice(PREFIX.length)
    const readerRoute = /^\/(signin|account|reader)(?:\/|$)/.test(path)
    const reading = request.method === "GET" || request.method === "HEAD"
    if (readerCookies || out.has("Set-Cookie") || readerRoute || !reading || /private|no-store/i.test(upstreamCache)) {
      out.set("Cache-Control", "private, no-store")
    } else {
      out.set("Cache-Control", "public, max-age=0, must-revalidate")
    }
  }
  return new Response(answer.body, { status: answer.status, headers: out })
}

export const Route = createFileRoute("/newsletter/the-end-of-explaining/$")({
  server: {
    handlers: {
      GET: forward,
      HEAD: forward,
      POST: forward,
      PUT: forward,
      PATCH: forward,
      DELETE: forward,
      OPTIONS: forward,
    },
  },
})
