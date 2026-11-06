<img src="public/logo.png" alt="Vertov" width="64" height="64" align="left">

# Vertov

**Open-source screen recorder and video messaging for Show-First Work.**

Vertov is a self-hostable screen recorder that runs on your own Cloudflare account. Record a browser tab, window, screen or camera, get a share link when you stop, edit the video by editing its transcript, and read the same recording as text through an API.

[Hosted service](https://vertov.app) · [Show-First Work](https://vertov.app/show-first-work) · [API and webhooks](https://vertov.app/docs/api) · [Chrome extension](https://chromewebstore.google.com/detail/vertov-screen-recorder/jdoejaekaomohdbefogghphmgadgepdm)

This is the free, self-hostable edition. The managed service at [vertov.app](https://vertov.app) is built on the same core and adds hosted-only features, listed in [Open source and hosted](#open-source-and-hosted).

## What is Show-First Work?

It is our name for a simple habit: when the work is visual, show it instead of writing paragraphs to describe it. A layout that looks wrong, a click that does nothing and an interaction that feels off are all quicker to record than to explain, and the person or AI agent who picks it up starts from what you showed. We call the cost of describing instead of showing the Translation Tax. We have not measured it, and these are working names rather than an established industry category. The longer explanation is at [vertov.app/show-first-work](https://vertov.app/show-first-work).

In Vertov the loop is Show, Act, Prove:

| Step | What you do | What this repository provides |
| --- | --- | --- |
| Show | Record what you mean | Browser and Chrome extension recording, with the share link ready when you stop |
| Act | Hand the context to a person or an agent | Share page with transcript and comments, an API that returns the transcript as JSON, and a Markdown brief for an AI agent |
| Prove | Look at what came back | Upload or record the result and share it the same way |

Vertov does not run agents or check their work. It records, stores and shares the context; the agent, and the person reviewing its output, are yours.

## What the open-source edition does

- **Record** a tab, window, screen or camera from the web app or the Chrome extension. The upload happens while you record, so the link is ready when you stop.
- **Share** with a link. Share pages have a transcript, comments, reactions, passwords, expiry and embeds.
- **Edit by text.** Cut words from the transcript, trim, add captions, text, boxes, arrows and links, and choose a background and layout. MP4 exports render with ffmpeg and include your edits. Captions download as SRT.
- **Live Rewind.** Viewers can watch while you are still recording.
- **Request a video.** Send a link and anyone records into your library without an account.
- **Organise and search.** Workspaces, spaces and folders, with search across titles and what was said.
- **Sign in** with a passkey, plus optional email links and Google.
- **Transcribe** with Whisper through Groq or Cloudflare Workers AI.

No plan limits and no billing: you pay Cloudflare directly for storage and compute.

## Using recordings from code and agents

These are the supported building blocks. Anything beyond them needs tooling you provide.

- **Read a recording as text.** `GET /api/v1/videos/{id}` returns the video with its timestamped transcript as JSON. Add `?format=prompt` for a Markdown brief that you can paste to a coding agent. In the web app, the same brief is under Share, Copy for an AI agent.
- **Add what happened on screen.** With "Capture clicks for AI & zooms" turned on in the Chrome extension, the brief also lists the pages you opened, the elements you clicked and the fields you typed in.
- **Upload and list.** `POST /api/v1/videos` uploads a file; `GET /api/v1/videos` lists videos. Create an API key under Settings, Agents. Keys are sent as `Authorization: Bearer rk_…`.
- **Webhooks.** `video.ready`, `video.viewed` and `comment.created`, signed with the Standard Webhooks scheme. Details are on the [API and webhooks](https://vertov.app/docs/api) page, which every deployment also serves at `/docs/api`.
- **Clients in this repository.** [`cli/`](cli) is a zero-dependency command line (`VERTOV_URL` points it at your server), [`raycast/`](raycast) has a Server setting for self-hosted installs, and [`workspace-addon/`](workspace-addon) is a Google Workspace add-on that talks to vertov.app only.

Example: record a UI bug with the extension, copy the brief, and give it to your coding agent along with the repository. The agent works from your recording; reviewing its change, or recording the fixed behaviour, is still a step you do.

## Open source and hosted

| | Open source (this repository) | Hosted at vertov.app |
| --- | --- | --- |
| Recording, share pages, transcript editing, MP4 export, Live Rewind, video requests, spaces and folders, search | Included | Included |
| HTTP API, API keys, webhooks, Markdown briefs for agents | Included | Included |
| Transcription | Whisper through Groq (your key) or Workers AI | Managed |
| Passkey, email and Google sign-in | Included; email needs SES keys | Included |
| MCP server and the Claude and OpenAI plugins in [`plugins/`](plugins) | Not included. The plugins connect to the hosted server at vertov.app/mcp | Included |
| AI titles, summaries, chapters and documents; caption translation | Not included | Included |
| Tutorial generation for your own app | Not included | Included |
| Analytics, playlists, Loom import, search indexing, Slack, custom branding, SCIM and audit export | Not included | Included |
| Studio effects: zooms, blur, spotlight, image overlays, styled captions, noise reduction, intro and outro clips, combining videos, camera backgrounds | Not included | Included |
| Billing and plans | None | Included |
| Infrastructure | You run it on Cloudflare | Managed |

## Stack

TanStack Start on Cloudflare Workers, D1 for the database, R2 for video files, Queues for transcription and exports, and a Cloudflare Container running ffmpeg for exports. The Chrome extension is plain Manifest V3 JavaScript in `extension/`.

## Run it locally

You need Node.js, pnpm and a Cloudflare account. Transcription uses the Workers AI binding, which Wrangler connects to your account, so log in first and, if you have several accounts, set `CLOUDFLARE_ACCOUNT_ID`.

```bash
pnpm install
npx wrangler login
cp .dev.vars.example .dev.vars
pnpm run db:migrate:local
pnpm run dev            # http://localhost:3000
```

## Deploy to Cloudflare

Docker must be running, because Wrangler builds and pushes the exporter image from `exporter/`. Check Cloudflare's current plan requirements for Containers and Queues first.

```bash
npx wrangler login
npx wrangler d1 create vertov             # put the database_id in wrangler.jsonc
npx wrangler r2 bucket create vertov-media
npx wrangler queues create vertov-process
pnpm run db:migrate:remote
npx wrangler secret put BETTER_AUTH_SECRET
pnpm run deploy
```

The names above are the ones in `wrangler.jsonc`; change both if you want different ones. Optional secrets, set the same way: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google sign-in, `GROQ_API_KEY` to transcribe with Groq instead of Workers AI, and `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` (plus `SES_REGION` and `EMAIL_FROM`) to send email through Amazon SES. Passkey sign-in needs no setup; email links need SES.

## Chrome extension

Load `extension/` unpacked in Chrome. In the popup choose "Self-hosting? Change the server" and enter your Worker's URL before connecting.

## Contributing

Pull requests are welcome. Before one can be merged, its author agrees to the [Contributor License Agreement](CLA.md) by leaving a one-line comment on the pull request. See [CONTRIBUTING.md](CONTRIBUTING.md). Features listed as hosted-only above are unlikely to be merged here.

## License

AGPL-3.0, see `LICENSE` and `NOTICE.md`. The name and logo are not covered by the license.
