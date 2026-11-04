---
name: vertov-videos
description: Work with Vertov screen recordings. Use when the user shares a vertov.app link, asks about something they or a teammate recorded, wants a document written from a recording, or wants a video file turned into a share link.
---

# Working with Vertov videos

Vertov is a screen recorder. Every recording has a share link like `https://vertov.app/k3J9x2ab`, a transcript and, once processed, a summary and chapters. The Vertov connector gives you tools to read and add videos in the workspace the user connected.

## Reading a recording

- When the user pastes a Vertov link and wants something done from it (a bug fixed, a process followed, a change made), call `get_video_prompt`. It returns what the person showed and said, in order, with timestamps and any clicks the Chrome extension captured.
- For the raw facts (title, status, summary, chapters, full transcript), call `get_video`.
- If `status` isn't `ready`, or there's no transcript yet, tell the user the video is still processing rather than guessing at its contents.
- Quote timestamps as `m:ss` so the user can jump to them. A link to a moment is the share link with `?t=<seconds>`.

## Finding recordings

- `list_videos` with no query lists the user's recent videos. With a query it searches titles, summaries and transcripts across everything the user can see in the workspace.
- `list_spaces` lists shared spaces. Use a space id only when the user asks to file a video somewhere.

## Writing from a recording

- `get_ai_doc` returns a document that was already written (kinds: summary-doc, sop, bug-report, meeting-notes, changelog, handoff, action-items, message).
- `generate_ai_doc` writes a new one and replaces any earlier document of the same kind, so check with `get_ai_doc` first and confirm with the user before replacing one. It needs a paid plan with AI.

## Adding videos

- `upload_video` with `data_base64` uploads a file of up to about 15 MB and returns its share link. Without `data_base64` it returns a curl command that needs a Vertov API key, which is only useful when the user can run commands.
- `create_video_from_url` copies a video from a public https URL.
- After uploading, give the user the share link. New videos are visible to anyone with the link unless the user changes that on the video page.

## Comments

`add_comment` posts as the user and everyone who can watch the video sees it. Only comment when the user asks you to, and show them the text first if it's more than a line.

## Tutorials

`list_tutorial_recipes`, `start_tutorial`, `get_tutorial_job` and `cancel_tutorial_job` drive a tutorial runner on the workspace owner's computer. They only work for owners and admins who have set up a runner.
