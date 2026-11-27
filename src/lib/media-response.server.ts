import { env } from "cloudflare:workers"
import { denyUnlessViewable } from "@/lib/access.server"
import { withCors } from "@/lib/api.server"
import { HOSTED_EDITION } from "@/lib/edition"
import { getUploadById } from "@/lib/uploads.server"
import { copyForRequest } from "@/lib/viewer-copy-access.server"

interface ByteRange {
  offset: number
  length: number
}

/** Parses a single-range `Range: bytes=...` header against a known size.
 *  Multi-range requests fall back to the full body. */
export function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, startRaw, endRaw] = match

  if (startRaw === "" && endRaw !== "") {
    // Suffix range: last N bytes.
    const length = Math.min(Number(endRaw), size)
    if (length === 0) return null
    return { offset: size - length, length }
  }
  if (startRaw === "") return null

  const offset = Number(startRaw)
  if (offset >= size) return null
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1)
  if (end < offset) return null
  return { offset, length: end - offset + 1 }
}

/**
 * Serves an upload's primary media from R2, honoring Range requests so
 * video seeking works without downloading the whole file. The range is
 * parsed here rather than delegated to R2 so behavior is identical in
 * production and local Miniflare.
 *
 * The request is required: every response is checked against the share's
 * access rules (password, expiry, members-only, removed, email gate,
 * unclaimed guest) before any bytes leave R2. The "image" track serves only
 * uploads the viewer treats as images, never a video's primary file.
 */
export async function serveMedia(
  id: string,
  request: Request,
  track: "screen" | "image" | "camera" = "screen",
): Promise<Response> {
  const singleRead = track === "screen" && HOSTED_EDITION && Reflect.get(env, "MEDIA_READ_ONCE") === "1"
  const loaded = singleRead ? await getUploadById(id) : null
  if (singleRead && !loaded) return withCors(new Response("Not found", { status: 404 }))
  // A primary video uses the same row for storage metadata and access checks.
  const row = loaded ? { r2_key: loaded.r2Key, content_type: loaded.contentType } : await env.DB.prepare(
    track === "camera"
      ? "SELECT camera_key AS r2_key, camera_content_type AS content_type FROM uploads WHERE id = ? AND status = 'ready'"
      : track === "image"
        ? "SELECT r2_key, content_type FROM uploads WHERE id = ? AND media_type <> 'video'"
        : "SELECT r2_key, content_type FROM uploads WHERE id = ?",
  )
    .bind(id)
    .first<{ r2_key: string | null; content_type: string | null }>()

  if (!row?.r2_key || !row.content_type) {
    return withCors(new Response("Not found", { status: 404 }))
  }
  const upload = loaded ?? await getUploadById(id)
  if (!upload) return withCors(new Response("Not found", { status: 404 }))
  const denied = await denyUnlessViewable(upload, request)
  if (denied) return denied
  const restricted = Boolean(upload.visibility === "workspace")
  // An edited video's viewers get the copy with the removed footage blanked, or nothing until it exists.
  const copy = track === "image" ? null : await copyForRequest(upload, track, request)
  if (copy === "held") return withCors(new Response("This video is being updated", { status: 409, headers: { "cache-control": "no-store" } }))
  const copied = copy && copy !== "editor" ? copy : null
  if (copied) row.r2_key = copied.key
  // Only a URL naming this copy may be kept for good: a bare one must see the next edit.
  const lasting = !copy || (copied !== null && new URL(request.url).searchParams.get("v") === copied.token)

  const head = await env.BUCKET.head(row.r2_key)
  if (!head) {
    return withCors(new Response("Not found", { status: 404 }))
  }

  const rangeHeader = request.headers.get("range")
  const range = rangeHeader ? parseRange(rangeHeader, head.size) : null

  const object = await env.BUCKET.get(
    row.r2_key,
    range ? { range } : undefined,
  )
  if (!object) {
    return withCors(new Response("Not found", { status: 404 }))
  }

  const headers = new Headers()
  headers.set("content-type", copied?.contentType ?? row.content_type)
  headers.set("cache-control", restricted || copy === "editor" ? "private, max-age=3600" : lasting ? "public, max-age=31536000, immutable" : "public, max-age=60")
  headers.set("etag", object.httpEtag)
  headers.set("accept-ranges", "bytes")

  if (range) {
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
    )
    headers.set("content-length", String(range.length))
    return withCors(new Response(object.body, { status: 206, headers }))
  }

  headers.set("content-length", String(head.size))
  return withCors(new Response(object.body, { headers }))
}

/** Serves a sidecar asset (poster, transcript) straight from R2. */
export async function serveAsset(
  r2Key: string | null,
  contentType: string,
  cacheControl = "public, max-age=31536000, immutable",
): Promise<Response> {
  if (!r2Key) {
    return withCors(new Response("Not found", { status: 404 }))
  }

  const object = await env.BUCKET.get(r2Key)
  if (!object) {
    return withCors(new Response("Not found", { status: 404 }))
  }

  const headers = new Headers()
  headers.set("content-type", contentType)
  headers.set("cache-control", cacheControl)
  headers.set("etag", object.httpEtag)
  return withCors(new Response(object.body, { headers }))
}
