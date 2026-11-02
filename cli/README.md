# vertov CLI

Zero-dependency command line for [Vertov](https://vertov.app). Needs Node 18+.

```bash
node vertov.mjs login rk_your_key   # or: npm link, then `vertov login ...`
vertov list
vertov copy latest
vertov open <id>
vertov record
```

| Command | What it does |
| --- | --- |
| `login <rk_key>` | Saves the key to `~/.config/vertov/cli.json` (mode 600). `VERTOV_KEY` also works. |
| `list [--json]` | Recordings, newest first: id, length, status, title. |
| `link <id\|latest>` | Prints the share link. |
| `copy [id\|latest]` | Copies the share link (`pbcopy`, `wl-copy`, `xclip`, `xsel`, `clip`). |
| `open [id\|latest]` | Opens the recording in your browser. |
| `record` | Opens the recorder. |

Set `VERTOV_URL` to point at a self-hosted server.
