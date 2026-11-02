import { createFileRoute } from "@tanstack/react-router"
import { APP_NAME } from "@/lib/brand"

const LIST = `curl 'https://vertov.app/api/v1/videos' \\
  -H 'Authorization: Bearer rk_your_key'

{ "videos": [{ "id": "k3J9x", "url": "https://vertov.app/k3J9x", "title": "Homepage walkthrough",
  "duration": 94, "status": "ready", "createdAt": "2026-11-01T10:12:00Z", "owner": "Priya", "snippet": "..." }] }`

const UPLOAD = `curl -X POST 'https://vertov.app/api/v1/videos?title=What%20I%20changed' \\
  -H 'Authorization: Bearer rk_your_key' \\
  -H 'Content-Type: video/webm' \\
  --data-binary @recording.webm`

const PAYLOAD = `POST https://your-server.example/hooks/vertov
webhook-id: msg_2f9c0a...
webhook-timestamp: 1793527920
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2/3+hk0qlyF3RcE=

{
  "type": "video.ready",
  "timestamp": "2026-11-01T10:12:00.000Z",
  "data": { "id": "k3J9x", "url": "https://vertov.app/k3J9x", "title": "Homepage walkthrough", "duration": 94 }
}`

const VERIFY = `import { createHmac, timingSafeEqual } from "node:crypto"

// rawBody must be the exact request body string, before any JSON parsing.
export function verify(secret, headers, rawBody) {
  const id = headers["webhook-id"]
  const timestamp = headers["webhook-timestamp"]
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false // replay window

  const key = Buffer.from(secret.replace("whsec_", ""), "base64")
  const expected = createHmac("sha256", key).update(\`\${id}.\${timestamp}.\${rawBody}\`).digest("base64")

  return headers["webhook-signature"].split(" ").some((entry) => {
    const [version, signature] = entry.split(",")
    return version === "v1" && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  })
}`

const EVENTS: Array<[string, string, string]> = [
  ["video.ready", "A recording, upload or import finished and is playable.", "id, url, title, duration"],
  ["video.viewed", "Someone other than the owner opened a video (one per viewer per video).", "id, url, title, country, referrer"],
  ["comment.created", "A signed-in viewer or a named guest commented.", "id, videoId, url, author, text, timestamp"],
]

export const Route = createFileRoute("/docs/api")({
  head: () => ({
    meta: [
      { title: `API and webhooks · ${APP_NAME}` },
      { name: "description", content: `List and upload videos with an API key, and receive signed webhooks when videos are ready, viewed or commented on in ${APP_NAME}.` },
    ],
  }),
  component: ApiDocs,
})

function Code({ children }: { children: string }) {
  return <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">{children}</pre>
}

function ApiDocs() {
  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="mx-auto max-w-2xl px-4 pt-8"><a href="/" className="font-semibold">{APP_NAME}</a></header>
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-bold tracking-tight">API and webhooks</h1>
        <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
          Create a key under Settings → Agents. A key acts as you in one workspace. Webhooks are managed in the same place by owners and admins.
        </p>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight">Authentication</h2>
          <p className="mt-3 leading-relaxed text-zinc-700 dark:text-zinc-300">
            Send the key as <code className="font-mono">Authorization: Bearer rk_…</code>. CORS is open, so the API also works from a browser extension or a small script.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight">List videos</h2>
          <p className="mt-3 text-zinc-700 dark:text-zinc-300">
            <code className="font-mono">GET /api/v1/videos</code> returns the videos the key's owner can see in that workspace.
          </p>
          <Code>{LIST}</Code>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight">Upload a video</h2>
          <p className="mt-3 text-zinc-700 dark:text-zinc-300">
            <code className="font-mono">POST /api/v1/videos</code> with the file as the request body. The response carries the share link; the video is playable as soon as it returns.
          </p>
          <Code>{UPLOAD}</Code>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight">Webhooks</h2>
          <p className="mt-3 leading-relaxed text-zinc-700 dark:text-zinc-300">
            Each event is a POST with a JSON body. Respond with any 2xx within 8 seconds. Deliveries are sent once, with no automatic retries, so treat them as a fast signal and
            list the videos if you need to catch up. Endpoints must be public https addresses.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4 font-semibold">Event</th>
                  <th className="py-2 pr-4 font-semibold">Sent when</th>
                  <th className="py-2 font-semibold">data fields</th>
                </tr>
              </thead>
              <tbody>
                {EVENTS.map(([name, when, fields]) => (
                  <tr key={name} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                    <td className="py-2 pr-4 font-mono text-xs">{name}</td>
                    <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{when}</td>
                    <td className="py-2 font-mono text-xs">{fields}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Code>{PAYLOAD}</Code>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight">Verify the signature</h2>
          <p className="mt-3 leading-relaxed text-zinc-700 dark:text-zinc-300">
            Requests follow the Standard Webhooks scheme, so any of its libraries work with your <code className="font-mono">whsec_…</code> secret. The signature is the base64
            HMAC-SHA256 of <code className="font-mono">webhook-id.webhook-timestamp.body</code>, keyed with the decoded secret. Check it against the raw body and reject old timestamps.
          </p>
          <Code>{VERIFY}</Code>
        </section>
      </main>
    </div>
  )
}
