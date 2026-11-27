-- Vertov voices: voiceover through Vertov's own ElevenLabs account, metered in characters (1 credit = 1 character of script).
ALTER TABLE workspaces ADD COLUMN voice_credits INTEGER NOT NULL DEFAULT 0;
CREATE TABLE voice_credit_ledger (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  upload_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX voice_credit_ledger_workspace ON voice_credit_ledger (workspace_id, created_at);
