import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { json } from "@/lib/api.server"
import { getAuth } from "@/lib/auth.server"
import { workspaceApi } from "@/lib/workspace-api.server"

const MAX_AVATAR = 1024 * 1024
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

async function currentKey(userId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT image FROM "user" WHERE id = ?`).bind(userId).first<{ image: string | null }>()
  const match = row?.image?.match(/^\/api\/avatar\/[^?]+\?v=(.+)$/)
  return match ? `avatars/${userId}-${match[1]}` : null
}

/** Stores the image, points the user at it, and removes the previous upload. */
async function setAvatar(userId: string, bytes: ArrayBuffer, type: string): Promise<string> {
  const version = crypto.randomUUID().slice(0, 8)
  const key = `avatars/${userId}-${version}`
  const previous = await currentKey(userId)
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } })
  const url = `/api/avatar/${userId}?v=${version}`
  await env.DB.prepare(`UPDATE "user" SET image = ? WHERE id = ?`).bind(url, userId).run()
  if (previous) await env.BUCKET.delete(previous)
  return url
}

/** The signed-in user's own profile picture: upload one (raw image body), pull it from their Google account (?source=google), or remove it. */
export const Route = createFileRoute("/api/profile/avatar")({
  server: {
    handlers: {
      POST: ({ request }) =>
        workspaceApi(request, async (user) => {
          const source = new URL(request.url).searchParams.get("source")
          if (source === "google") {
            let token: string | undefined
            const linked = await env.DB.prepare(`SELECT id FROM account WHERE userId = ? AND providerId = 'google' LIMIT 1`).bind(user.sub).first<{ id: string }>()
            try {
              // Refreshes the access token when it has expired.
              if (linked) token = (await getAuth(request).api.getAccessToken({ body: { accountId: linked.id, userId: user.sub }, headers: request.headers }))?.accessToken
            } catch {
              token = undefined
            }
            if (!token) return json({ error: "No Google account is linked. Sign in with Google to use its photo." }, 404)
            const profile = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${token}` } })
            const picture = profile.ok ? ((await profile.json()) as { picture?: string }).picture : undefined
            if (!picture) return json({ error: "Your Google account has no profile photo." }, 404)
            // Google serves a small size by default; ask for 256 px square.
            const image = await fetch(picture.replace(/=s\d+(-c)?$/, "") + "=s256-c")
            const type = (image.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
            if (!image.ok || !TYPES[type]) return json({ error: "Could not download your Google photo." }, 502)
            const bytes = await image.arrayBuffer()
            if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR) return json({ error: "Your Google photo is too large." }, 502)
            return json({ ok: true, avatar: await setAvatar(user.sub, bytes, type) })
          }
          const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
          if (!TYPES[type]) return json({ error: "Use a PNG, JPEG or WebP image" }, 400)
          const bytes = await request.arrayBuffer()
          if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR) return json({ error: "Picture must be under 1 MB" }, 400)
          return json({ ok: true, avatar: await setAvatar(user.sub, bytes, type) })
        }),
      DELETE: ({ request }) =>
        workspaceApi(request, async (user) => {
          const previous = await currentKey(user.sub)
          await env.DB.prepare(`UPDATE "user" SET image = NULL WHERE id = ?`).bind(user.sub).run()
          if (previous) await env.BUCKET.delete(previous)
          return json({ ok: true })
        }),
    },
  },
})
