/**
 * Which hosted stack this Worker is. The US stack (vertov.app) and the EU stack (eu.vertov.app) run the same code with
 * their own database, buckets and queue (docs/eu-data-location-plan.md). The region is a deploy-time setting, never read
 * from a request, so one stack can never answer for the other's accounts.
 *
 * Pure and client-safe: callers pass the Worker env (see region.server.ts) or the sign-in loader's result.
 */
export type Region = "us" | "eu"

export const REGIONS: Record<Region, { host: string; origin: string; label: string }> = {
  us: { host: "vertov.app", origin: "https://vertov.app", label: "Global" },
  eu: { host: "eu.vertov.app", origin: "https://eu.vertov.app", label: "European Union" },
}

/** Marketing pages, canonical URLs, sitemaps and structured data stay on the US host, whichever stack serves the request. */
export const SITE_ORIGIN = REGIONS.us.origin

export interface RegionEnv {
  VERTOV_REGION?: string
  APP_URL?: string
  /** "on" once both stacks are live: only then does sign-up ask where an account should live. */
  EU_SIGNUP?: string
}

export const regionChoiceEnabled = (source?: RegionEnv | null): boolean => String(source?.EU_SIGNUP ?? "").trim().toLowerCase() === "on"

export function regionOf(source?: RegionEnv | null): Region {
  return String(source?.VERTOV_REGION ?? "").trim().toLowerCase() === "eu" ? "eu" : "us"
}

/** The public origin of an account's own stack: where its links, email buttons and unsubscribe pages point. */
export function appOrigin(source?: RegionEnv | null): string {
  const override = String(source?.APP_URL ?? "").trim().replace(/\/+$/, "")
  return override || "http://localhost:3000"
}

/** The region whose host this is, or null for any other host (localhost, a preview, a self-hosted domain). */
export function regionForHost(hostname: string): Region | null {
  const host = hostname.toLowerCase()
  if (host === REGIONS.eu.host) return "eu"
  if (host === REGIONS.us.host || host === `www.${REGIONS.us.host}` || host === `admin.${REGIONS.us.host}`) return "us"
  return null
}

/**
 * Better Auth cookie prefix. The US stack keeps Better Auth's default so nobody is signed out; the EU stack gets its own
 * name so a session from one stack is never mistaken for the other's, even if a cookie were ever shared across hosts.
 */
export function sessionCookiePrefix(region: Region): string | undefined {
  return region === "eu" ? "vertov-eu" : undefined
}

// EU member states plus the countries that follow the same data-protection rules or are our nearest equivalent.
const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "GB", "CH",
])

/** The location a new account should start with, from Cloudflare's `cf-ipcountry`. Only a default: the person chooses. */
export function suggestRegion(country: string | null | undefined): Region {
  return EU_COUNTRIES.has(String(country ?? "").trim().toUpperCase()) ? "eu" : "us"
}

export const otherRegion = (region: Region): Region => (region === "eu" ? "us" : "eu")

/**
 * Which stack this browser last used, shared by vertov.app and eu.vertov.app. It holds only "us" or "eu": the two
 * databases stay separate, so this is how vertov.app knows to send an EU user to their own side.
 */
const REGION_COOKIE = "vertov_region"

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.split("=")
    if (key?.trim() === name) return value.join("=").trim()
  }
  return null
}

const hasSession = (header: string | null, region: Region): boolean =>
  cookieValue(header, `__Secure-${sessionCookiePrefix(region) ?? "better-auth"}.session_token`) !== null

/** The Set-Cookie to send when a signed-in browser's remembered stack is missing or different, otherwise null. */
export function regionCookieFor(url: URL, cookies: string | null): string | null {
  const region = regionForHost(url.hostname)
  if (!region || url.hostname.startsWith("admin.") || !hasSession(cookies, region)) return null
  if (cookieValue(cookies, REGION_COOKIE) === region) return null
  return `${REGION_COOKIE}=${region}; Domain=vertov.app; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`
}

/**
 * Where a plain sign-in on vertov.app should go instead for someone who uses the EU stack, or null to stay.
 * Anything with a purpose of its own (a page to return to, account creation, an email result, `here=1` from the
 * EU sign-in page) stays, as does anyone already signed in here.
 */
export function euSignInRedirect(url: URL, cookies: string | null): string | null {
  if (regionForHost(url.hostname) !== "us" || url.pathname !== "/signin") return null
  if (cookieValue(cookies, REGION_COOKIE) !== "eu" || hasSession(cookies, "us")) return null
  const params = url.searchParams
  if (params.has("here") || params.has("create") || params.has("email")) return null
  const next = params.get("redirect")
  if (next && next !== "/home") return null
  // Their library, not the sign-in form: a live session opens straight away, and an ended one asks them to sign in there.
  return `${REGIONS.eu.origin}/home`
}

/** The sign-in address on a stack, keeping the page they were heading to; `create` opens the account-creation form. */
export function signInUrl(region: Region, redirect?: string | null, create = false, here = false): string {
  const url = new URL("/signin", REGIONS[region].origin)
  if (redirect && redirect !== "/home") url.searchParams.set("redirect", redirect)
  if (create) url.searchParams.set("create", "1")
  // They chose this side on purpose, so vertov.app must not send them back.
  if (here) url.searchParams.set("here", "1")
  return url.href
}
