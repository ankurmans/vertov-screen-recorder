-- Plan ladder: a trial, referral bonus hours, the Free bank flag, per-workspace monthly counters and the referral ledger.
ALTER TABLE workspaces ADD COLUMN trial_ends_at TEXT;
ALTER TABLE workspaces ADD COLUMN bonus_hours REAL NOT NULL DEFAULT 0;
-- 0 on a Free workspace that is not its owner's first, so extra workspaces can't multiply the free hours.
ALTER TABLE workspaces ADD COLUMN free_bank INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspaces ADD COLUMN referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_referral_code ON workspaces (referral_code) WHERE referral_code IS NOT NULL;

-- One row per workspace, kind (ai, long_video) and period (YYYY-MM).
CREATE TABLE IF NOT EXISTS workspace_usage (
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, kind, period)
);

-- One reward per friend: the primary key makes settling a referral idempotent.
CREATE TABLE IF NOT EXISTS referrals (
  referee_user_id TEXT PRIMARY KEY,
  referrer_workspace_id TEXT NOT NULL,
  referee_workspace_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  rewarded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_workspace_id);

-- Every existing Free workspace owned by a claimed account gets the 14-day trial from the day this ships;
-- a guest's starts when the account is saved.
UPDATE workspaces SET trial_ends_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+14 days')
WHERE plan = 'free' AND trial_ends_at IS NULL
  AND created_by NOT IN (SELECT id FROM "user" WHERE "isAnonymous" = 1 AND id NOT IN (SELECT "userId" FROM passkey));
