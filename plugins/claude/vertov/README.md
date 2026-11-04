# Vertov for Claude

Vertov is a screen recorder that gives every recording a share link, a transcript and a summary. This plugin connects Claude to your Vertov workspace so Claude can read the recordings you can see and turn video files into share links.

## What it does

- Reads a Vertov link as a timestamped brief of what was shown and said, so you can say "fix the bug in this video" or "follow the steps in this recording".
- Searches your videos by title, summary and transcript.
- Writes documents from a recording: SOPs, bug reports, meeting notes, changelogs, handoffs and action items.
- Uploads a video file, or copies one from a public URL, and returns its share link.
- Adds comments to a video as you.

It includes the Vertov MCP server and a skill that explains how to use its tools.

## Setup

1. Install the plugin. In Claude Code:

   ```
   /plugin install vertov --marketplace ankurmans/vertov-screen-recorder
   ```

   In Claude on the web or desktop, add Vertov from the directory once it's listed.
2. When Claude first uses Vertov, it asks you to sign in. Sign in with your Vertov account, pick a workspace and choose Allow.
3. To disconnect later, open Settings in Vertov, then Agents, then Connected apps.

You need a Vertov account. It's free during early access.

## What it connects to

The plugin connects to one remote MCP server, `https://vertov.app/mcp`, run by the Vertov team. It sends that server the tool calls Claude makes (for example a video link to read, or a file to upload) and nothing else. The plugin runs no local code and has no hooks.

## Data and privacy

The server can reach only the workspace you chose when signing in, and only videos you could already open there. No tool deletes videos or changes who can see them. Privacy policy: https://vertov.app/privacy. Terms: https://vertov.app/terms.

## Help

Docs: https://vertov.app/docs/mcp. Support: https://vertov.app/support or support@vertov.app.

## License

AGPL-3.0-only, like the rest of the Vertov source in this repository.
