-- Agent-recorded tutorials on Vertov's own recorder. A workspace registers its app (verified by a DNS TXT record or a
-- file on the site) and a demo login, sealed like ElevenLabs keys; jobs carry the steps an agent wrote.
CREATE TABLE recorder_apps (
  workspace_id TEXT PRIMARY KEY NOT NULL,
  origin TEXT NOT NULL,
  verify_token TEXT NOT NULL,
  verified_at TEXT,
  login_url TEXT,
  login_user TEXT,
  login_secret TEXT,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE recorder_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  origin TEXT NOT NULL,
  title TEXT NOT NULL,
  recipe TEXT NOT NULL,
  voice_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  stage TEXT,
  error TEXT,
  failed_step TEXT,
  screenshot_key TEXT,
  video_id TEXT,
  verified TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX idx_recorder_jobs_workspace ON recorder_jobs (workspace_id, created_at);
