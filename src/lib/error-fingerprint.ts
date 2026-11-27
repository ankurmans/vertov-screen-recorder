// Pure helpers behind the error tracker (error-report.server.ts): what makes two failures "the same", and what is noise.
const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")

/** Strips what varies between two occurrences of the same failure, and what could identify a person. */
export function scrub(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"')]+/g, (url) => {
      try {
        const parsed = new URL(url)
        return `${parsed.origin}${parsed.pathname}`
      } catch {
        return "<url>"
      }
    })
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b(?:Bearer|token|key|secret|password)[=: ]+\S+/gi, "<redacted>")
    .replace(/\b[0-9a-f]{8}\b/gi, "<id>")
    // React's minified errors are only identifiable by their number (#418 is a hydration mismatch), so that number stays.
    .replace(/(?<!error #)(?<!\/errors\/)\b\d{3,}\b/g, "<n>")
}

/**
 * Drops the values Drizzle appends to a failed query ("Failed query: <sql>\nparams: <values>"). They can be titles or
 * transcript text and can contain anything, so everything after the marker goes with them.
 */
export function withoutParams(message: string): string {
  const query = message.indexOf("Failed query:")
  const params = query < 0 ? -1 : message.indexOf("\nparams:", query)
  return params < 0 ? message : message.slice(0, params)
}

/** For rows stored before values were dropped: removes them and keeps the `[cause: …]` that follows. */
export function withoutStoredParams(message: string): string {
  const safe = withoutParams(message)
  if (safe === message) return message
  const cause = message.endsWith("]") ? message.lastIndexOf(" [cause: ") : -1
  return cause < safe.length ? safe : safe + message.slice(cause)
}

const MAX_MESSAGE = 500
const MAX_CAUSE = 200

/** Why a wrapped failure happened (the D1 error under Drizzle's "Failed query"), scrubbed and capped. Empty when nothing says. */
export function causeMessage(error: unknown): string {
  let cause = (error as { cause?: unknown } | null | undefined)?.cause
  for (let depth = 0; cause && depth < 6; depth++) {
    // Only error objects: a string or plain-data cause could be a request body.
    const { name, message, cause: next } = cause as { name?: unknown; message?: unknown; cause?: unknown }
    // A "Failed query" wrapper carries the bound values and not the reason, so look under it.
    if (typeof message === "string" && message && !message.startsWith("Failed query:")) {
      // A JSON SyntaxError quotes the text it could not parse.
      const text = name === "SyntaxError" ? message.replace(/".*"/s, '"<text>"') : withoutParams(message)
      return scrub(typeof name === "string" && name !== "Error" ? `${name}: ${text}` : text).slice(0, MAX_CAUSE)
    }
    cause = next
  }
  return ""
}

/** The stored and emailed message. The failure's own text is cut short enough that the cause always fits after it. */
export function withCause(message: string, cause: string): string {
  if (!cause) return message
  const suffix = ` [cause: ${cause}]`
  return message.slice(0, MAX_MESSAGE - suffix.length) + suffix
}

/** The first frames of a stack without line numbers or bundle hashes, so a redeploy does not make every error new. */
export function stackFrames(stack: string | undefined, depth = 4): Array<string> {
  if (!stack) return []
  return stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .map((line) => line.replace(/\(?(?:file|https?):\/\/[^)\s]*\/([^/)\s:]+?)(?:-[\w-]{6,12})?(\.[a-z]+)?(?::\d+)*\)?$/i, "($1)").replace(/:\d+(:\d+)?\)?$/, ")"))
    .slice(0, depth)
}

export async function fingerprintOf(source: string, name: string, message: string, frames: Array<string>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode([source, name, scrub(message), ...frames].join("\n")))
  return hex(digest).slice(0, 16)
}

// The last pattern is PostHog's own recorder throwing from inside its library (every frame is "(posthog)") when a reset or opt-out races its start; there is no Vertov code to fix.
const IGNORED = [/^ResizeObserver loop/i, /^Script error\.?$/i, /Non-Error promise rejection/i, /^AbortError/i, /The user aborted a request/i, /^Network request failed/i, /Load failed$/i, /Failed to fetch$/i, /\[SessionRecording\] must be started with a valid sessionManager/i]

/** True for noise that is not a bug in the app: browser quirks, aborted requests, extensions injecting into the page. */
export function ignorable(name: string, message: string, stack: string | undefined): boolean {
  if (IGNORED.some((pattern) => pattern.test(message) || pattern.test(`${name}: ${message}`))) return true
  return /(?:chrome|moz|safari)-extension:\/\//.test(stack ?? "")
}

