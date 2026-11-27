-- Error tracking: one row per distinct failure (fingerprint), plus the ids it touched. No message bodies from users, no emails.
CREATE TABLE IF NOT EXISTS error_events (
  fingerprint TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  route TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  count INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  alerted_at INTEGER,
  resolved_at INTEGER,
  fix_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_events_last_seen ON error_events(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_status ON error_events(status, last_seen DESC);
CREATE TABLE IF NOT EXISTS error_affected (
  fingerprint TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  upload_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, user_id, upload_id)
);
