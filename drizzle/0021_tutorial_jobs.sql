CREATE TABLE IF NOT EXISTS tutorial_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  recipe_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  parameters TEXT NOT NULL,
  presenter INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claim_expires_at TEXT,
  stage TEXT,
  step TEXT,
  message TEXT,
  percent INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  video_id TEXT,
  verified TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tutorial_jobs_workspace ON tutorial_jobs (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tutorial_jobs_state ON tutorial_jobs (workspace_id, state);
CREATE TABLE IF NOT EXISTS tutorial_runners (
  workspace_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, runner_id)
);
