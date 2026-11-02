# Chrome extension

Records a tab, the screen or the camera from the toolbar and uploads while you record, so the share link is ready the moment you stop. Optional click capture adds what you clicked and which pages you opened to the video's "Copy for an AI agent" brief. Also redirects old Loom links to their copies and copies private Looms using your own Loom sign-in.

Name and hosted server are the two constants in `brand.js`, plus `name` in `manifest.json`.

## Try it

1. `chrome://extensions` → turn on Developer mode → Load unpacked → pick this folder.
2. Click the icon → Connect. The site asks you to allow, then hands the extension an API key.
3. Self-hosting: open "Self-hosting? Change the server" in the popup before connecting.

## Package for the Chrome Web Store

```bash
cd extension && zip -r ../vertov-extension.zip . -x "README.md" -x ".*"
```

## What's where

- `background.js`: service worker. Starts and stops recordings, badge timer, Alt+Shift+R, Loom redirects and import.
- `offscreen.js`: the recorder (MediaRecorder, mixed audio, 5 MiB multipart parts, camera as its own track, audio sidecar, poster frames).
- `capture.js`: click and page capture, injected only while a recording with "capture clicks" is on. It sends the visible label and a selector, never what you type.
- `overlay.js` and `bubble.html`/`bubble.js`: the on-page camera bubble, pen (strokes fade after 4s) and cursor highlight, injected into the active tab during tab recordings.
- `gmail.js` and `gmail.css`: content script on mail.google.com. Adds a Vertov button beside Send in each compose window; the finished recording's poster image and link are inserted into that message (background.js `deliver`). Falls back to opening the share page if the compose is gone. Gmail's markup is undocumented, so selectors are loose and fail silently.
- `popup.js`, `connect.js`, `permissions.js`: UI. The connect handshake lives in the site's `/connect-extension` route.

## Known limits

- Chrome pages (`chrome://`, the Web Store) can't be tab-recorded; the popup disables "This tab" there.
- Whole-screen and window recordings use Chrome's own picker, with system audio where Chrome offers it (Windows and ChromeOS; on macOS only tab audio).
- Tab recordings show the camera as a bubble on the page (drag it, resize with Size, hover for Draw, Spot and Stop; Alt+Shift+D toggles the pen). Because it is a real page element, tab capture records it and no separate camera track is kept. Screen recordings keep the camera as its own track, composited on the share page.
- The bubble follows you to the tab you switch to, but whole-screen recordings only show it while a browser tab is in front.
