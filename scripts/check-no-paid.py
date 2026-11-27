#!/usr/bin/env python3
"""Fails when the tree holds a file or identifier of a feature this edition leaves out (the features marked hosted-only
in the README table). Run by .github/workflows/guard.yml on every push and pull request; run it locally with
`python3 scripts/check-no-paid.py`. It lists names only, so a manual push that adds one of those files is flagged."""
import os, re, subprocess, sys

PATHS = [r"voiceover", r"elevenlabs", r"cursor-layer", r"end-card", r"insights-panel", r"security-settings", r"workspace\.security",
         r"unlock\.", r"scim", r"ai-cover", r"caption-languages", r"polar-core", r"polar\.webhook", r"polar-setup", r"upgrade-prompt", r"(^|/)gates(\.|/)"]
CONTENT = [r"ElevenLabs|elevenlabs", r"CursorLayer", r"InsightsPanel", r"requireFeature", r"@polar-sh", r"api/unlock"]
EXEMPT = ("drizzle/", "src/db/schema.ts", "worker-configuration.d.ts", "pnpm-lock.yaml", "README.md", "NOTICE.md", "CONTRIBUTING.md",
          "scripts/check-no-paid.py", ".github/")

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = subprocess.check_output(["git", "-C", root, "ls-files", "-z"]).decode().split("\0")
problems = []
for rel in filter(None, files):
    if not rel.startswith("drizzle/"):
        problems += [f"{rel}: path matches /{p}/" for p in PATHS if re.search(p, rel)]
    if rel.startswith(EXEMPT):
        continue
    try:
        text = open(os.path.join(root, rel), encoding="utf-8").read()
    except (UnicodeDecodeError, OSError):
        continue
    problems += [f"{rel}: contains {m.group(0)!r}" for p in CONTENT if (m := re.search(p, text))]
if problems:
    print("This edition leaves out hosted-only features, and these files look like them:\n  " + "\n  ".join(problems), file=sys.stderr)
    sys.exit(1)
print("no hosted-only files or identifiers found")
