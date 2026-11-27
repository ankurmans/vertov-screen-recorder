/**
 * One public address per page: https, no www, no trailing slash. Pure so it can be tested; src/server.ts applies it.
 * Path and query string are kept as sent (sign-in and share links carry functional state in them).
 */
import { REGIONS } from "./region.ts"

const SITE_HOSTS: Record<string, string> = { "vertov.app": "vertov.app", "www.vertov.app": "vertov.app", "eu.vertov.app": "eu.vertov.app" }

// Machine endpoints where a trailing slash can mean something else, so they are left alone.
const KEEP_TRAILING_SLASH = ["/api/", "/.well-known/", "/scim", "/mcp", "/oauth", "/embed", "/media", "/assets"]

// Match marketing pages explicitly so workspace routes and short video links stay on their own stack.
const MARKETING_PATHS = new Set([
  "/about", "/pricing", "/enterprise", "/show-first-work", "/video-messages", "/walkthrough",
  "/open-source-loom-alternative", "/the-end-of-explaining", "/support", "/privacy", "/terms",
  "/sitemap.xml", "/llms.txt",
])
const MARKETING_SECTIONS = /^\/(alternatives|blog|design-lab|docs|features|for|learn|newsletter|newsroom|research|screen-recorder|tools|use-cases|vs)(\/|$)/

export interface CanonicalRedirect {
  location: string
  status: 301 | 308
}

/** Where a request should go instead, in a single hop, or null when it is already at its public address. */
export function canonicalRedirect(url: URL, method: string): CanonicalRedirect | null {
  const canonicalHost = SITE_HOSTS[url.hostname]
  if (!canonicalHost) return null
  const read = method === "GET" || method === "HEAD"
  let pathname = url.pathname
  if (read && pathname.length > 1 && pathname.endsWith("/") && !KEEP_TRAILING_SLASH.some((prefix) => pathname.startsWith(prefix))) {
    pathname = pathname.replace(/\/+$/, "") || "/"
  }
  const marketing = MARKETING_PATHS.has(pathname) || MARKETING_SECTIONS.test(pathname)
  const host = read && canonicalHost === REGIONS.eu.host && marketing ? REGIONS.us.host : canonicalHost
  const moved = url.protocol !== "https:" || url.hostname !== host || pathname !== url.pathname
  if (!moved) return null
  // 308 keeps the method and body for a POST that arrived over http; a permanent 301 would turn it into a GET.
  return { location: `https://${host}${pathname}${url.search}`, status: read ? 301 : 308 }
}
