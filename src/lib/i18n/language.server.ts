import { env } from "cloudflare:workers"
import { loadCatalog } from "./catalogs.ts"
import { followsAppLanguage, isAppLanguage, resolveLanguage, type AppLanguage } from "./languages.ts"
import type { Catalog } from "./core.ts"

/**
 * The saved language for a browser session, in one statement (the session row joined to the preference row), so a page load pays one read
 * and not a second session lookup. The token alone identifies the session; a forged or revoked one matches nothing.
 */
export async function savedLanguageForSession(cookie: string): Promise<AppLanguage | null> {
  const match = /(?:^|;\s*)[^=;\s]*session_token=([^;]*)/.exec(cookie)
  if (!match) return null
  let token: string
  try {
    token = decodeURIComponent(match[1]).split(".")[0]
  } catch {
    return null
  }
  if (!token) return null
  const row = await env.DB.prepare('SELECT p.language AS language FROM "session" s JOIN user_preferences p ON p.user_id = s."userId" WHERE s.token = ?').bind(token).first<{ language: string | null }>()
  return isAppLanguage(row?.language) ? row.language : null
}

export async function saveLanguage(userId: string, language: AppLanguage): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO user_preferences (user_id, language, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET language = excluded.language, updated_at = excluded.updated_at",
  ).bind(userId, language, new Date().toISOString()).run()
}

export type RequestLanguage = {
  language: AppLanguage
  /** Where the language came from; "saved" means the browser should remember it in a cookie. */
  source: "query" | "cookie" | "saved" | "browser" | "default"
  /** The page follows the app language (app and share pages), so the catalog applies. */
  app: boolean
  catalog: Catalog | null
}

/**
 * The language for one request. Marketing pages get English and no catalog, so their HTML never depends on a visitor's choice.
 * The saved choice is read only when there is a session and no cookie.
 */
export async function languageForRequest(request: Request, pathname: string): Promise<RequestLanguage> {
  if (!followsAppLanguage(pathname)) return { language: "en", source: "default", app: false, catalog: null }
  const cookie = request.headers.get("cookie")
  const sources = { query: new URL(request.url).searchParams.get("lang"), cookie, acceptLanguage: request.headers.get("accept-language") }
  let resolved = resolveLanguage(sources)
  if (resolved.source !== "query" && resolved.source !== "cookie" && cookie?.includes("session_token")) {
    try {
      const saved = await savedLanguageForSession(cookie)
      if (saved) resolved = { language: saved, source: "saved" }
    } catch {
      // A failed lookup falls back to the browser language rather than blocking the page.
    }
  }
  return { ...resolved, app: true, catalog: await loadCatalog(resolved.language) }
}
