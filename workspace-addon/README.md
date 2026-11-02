# Vertov for Google Workspace

Apps Script add-on: insert a Vertov video into a Gmail draft, attach one to a Calendar event, open the recorder.
Setup, listing text and verification notes are in `docs/workspace-marketplace.md`.

- `appsscript.json`: manifest (scopes, triggers, the single allowed host https://vertov.app/).
- `Code.gs`: all of the add-on.
- `assets/`: 128px and 32px Kino-Eye icons for the Marketplace listing.

Uses the public API only: `GET /api/v1/videos` with `Authorization: Bearer rk_…` (a key created at https://vertov.app/settings) and the animated thumbnail at `/api/gif/<id>`.
