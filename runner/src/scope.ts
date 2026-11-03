/** What the browser may reach. Recipes only ever act on the app's own origin. */

export function resolveInScope(appOrigin: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) throw new Error(`Refusing path “${path}”: recipes may only open paths on the app`)
  const url = new URL(path, appOrigin)
  if (url.origin !== new URL(appOrigin).origin) throw new Error(`Refusing path “${path}”: it leaves ${appOrigin}`)
  return url.toString()
}

const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"])

/** Documents (pages and frames) and top-level navigations must stay on the app's origin; other assets may load. */
export function allowRequest(appOrigin: string, url: string, resourceType: string, isNavigation: boolean): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return true
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return false
  if (isNavigation || resourceType === "document") return parsed.origin === new URL(appOrigin).origin
  return true
}
