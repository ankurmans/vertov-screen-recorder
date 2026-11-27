---
name: vertov-proof
description: Record a short clip of finished work and share it as a Vertov link. Use when the user asks to be shown that something works, asks for a recording or proof with a pull request, or wants a screen recording of the change you just made.
---

# Showing the result

A reviewer can watch a short clip faster than they can run a branch.

## Ask first

An upload creates a share link. Unless the workspace limits videos to members, anyone holding the link can watch it. Tell the user what the clip will show and get their yes before uploading. Putting the link in a pull request, issue or chat is a separate step: do it when they asked for that, otherwise ask.

## Record

Show only the change working, in under a minute.

- Web app: Playwright's `recordVideo`, or a CDP screencast.
- Desktop app or terminal: `ffmpeg` screen capture of that window.
- iOS Simulator: `xcrun simctl io booted recordVideo proof.mp4`.

Use test data. The clip must not show passwords, keys, tokens, customer data, other windows or notifications. Look at frames from the file before uploading it, and record again if anything private is visible. The file must be MP4 or WebM.

## Upload

- Up to about 15 MB: `upload_video` with `data_base64`, `content_type`, `duration` and a title such as "Proof: sign-in error is fixed".
- Larger: call `upload_video` without `data_base64` for a curl command, which needs a Vertov API key.

Then call `get_video` with the new link to check that it is ready.

## Report

Give the link and say what it shows, with `?t=<seconds>` links to the moments that matter. In a pull request:

```markdown
**Proof:** [watch the change working](<share link>)
```

A recording shows only what is in it. Say what you did not record or check.
