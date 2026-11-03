# Vertov

A screen recorder and video messaging tool you can run on your own Cloudflare account. Record a tab, window, screen or camera, get a share link the moment you stop, then edit by transcript.

This is the free, self-hostable edition. The hosted service at [vertov.app](https://vertov.app) is built on the same core and adds billing, managed infrastructure and hosted-only features: an MCP server, tutorial generation, analytics, playlists, Loom import, search indexing, camera backgrounds, SCIM and audit export.

## What you get

- Record from the web app or the Chrome extension. The upload happens while you record, so the link is ready when you stop.
- Share pages with transcript, chapters, comments, reactions, passwords, expiry and embeds.
- Edit by text: cut words from the transcript, trim, add captions, links and annotations, combine videos, choose a background and layout. Exports render with ffmpeg and include your edits.
- Live Rewind: viewers watch while you are still recording.
- Request a video: send a link and anyone records into your library with no account.
- Workspaces, spaces, folders and search across what was said.
- An HTTP API and webhooks so scripts and agents can upload videos and read them back as transcripts and briefs.
- Passkey sign-in, with optional email links and Google.

No plan limits and no billing: you pay Cloudflare directly for storage and compute.

## Stack

TanStack Start on Cloudflare Workers, D1 (database), R2 (video files), Queues (transcription and exports) and a Cloudflare Container running ffmpeg for exports. Transcription uses Whisper through Groq or Workers AI. The Chrome extension is plain Manifest V3 JavaScript in `extension/`.

## Run it locally

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm run dev            # http://localhost:3000
pnpm run db:migrate:local
```

## Deploy to Cloudflare

1. Create a D1 database, an R2 bucket and a Queue. Put their names and IDs in `wrangler.jsonc`.
2. `pnpm run db:migrate:remote`
3. Set secrets with `wrangler secret put`: `BETTER_AUTH_SECRET` (required), and optionally `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GROQ_API_KEY`, and `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` for email.
4. Build and push the exporter image from `exporter/`, then `pnpm run deploy`.

## Chrome extension

Load `extension/` unpacked in Chrome. In the popup choose "Self-hosting? Change the server" and enter your Worker's URL before connecting.

## License

AGPL-3.0, see `LICENSE` and `NOTICE.md`. The name and logo are not covered by the license.
