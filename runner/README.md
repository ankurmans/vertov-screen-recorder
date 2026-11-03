# Vertov tutorial runner

Runs on your Mac. It polls Vertov for tutorial jobs, performs the recipe in a dedicated browser, records it at 1920×1080, produces the narrated MP4 and uploads it as a private Vertov video. Nothing listens on your machine and no tunnel is needed: the runner only makes outgoing requests.

## One-time setup

```bash
cd runner
npm install
npx playwright-core install ffmpeg   # the small ffmpeg Playwright uses to record video
```

1. **API key.** Create an `rk_` key in Vertov (Settings → API keys, as a workspace owner or admin). Put it in `~/.config/vertov/runner.env` (mode 600) or export it. Never commit it.
   ```
   VERTOV_API_KEY=rk_...
   VERTOV_APP_URL=https://vertov.app
   ```
2. **Browser session.** `npm run setup` opens a dedicated Chrome for Testing window (profile in `runner/state/`, not your everyday Chrome). Sign in yourself; the window saves the session to `~/.config/vertov/runner/session.json` (mode 600, outside git) and closes. Use a demo account that has at least one video in My videos.
3. **Browser.** Chrome for Testing is expected at `~/.agent-browser/browsers/chrome-146.0.7680.80/`; set `CHROME_PATH` to use another build. Never point it at your everyday Chrome.
4. **Voice (optional).** Narration uses the production modules in `src/production/`; without a speech key the run is silent and paced from the script.

## Run

```bash
npm start                                   # poll for jobs until Ctrl-C
npm run run-local -- create-space-and-organize --no-upload   # try a recipe without the job API or upload
npm run run-local -- create-space-and-organize --param spaceName="Design reviews"
```

Ctrl-C cancels the active job (another attempt can pick it up later) and closes the browser. A cancel from the app is noticed at the next progress report (every step, and every 15 seconds at least).

## Local test environment

Point at a local build and create a throwaway guest session (refused for any non-local origin):

```bash
VERTOV_APP_URL=http://localhost:8787 npm run setup -- --guest
```

## Artifacts

Each job writes to `runner/artifacts/<jobId>/`: `run.json` (what finished and the uploaded video id, written before the server is told so a retry never uploads twice), failure screenshots and, if anything failed, the raw recording. After success only the final MP4 and `run.json` stay.

## Safety

- The browser may only open pages on the app origin; other origins' documents are blocked. Recipes are data: no scripts, no shell.
- Cookies stay in the session file; they are never printed, uploaded or put in a recipe.
- A step whose expected result is missing stops the run and reports why. Steps with no expectation are reported as unverified.

## Tests

```bash
npm test          # unit tests plus real-browser integration tests against a local fixture page
npm run typecheck
```
