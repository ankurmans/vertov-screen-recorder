-- Referrals: record the hours each side was actually granted (the workspace cap can shrink a grant to less than 2 or 0),
-- so a reward can be revoked for abuse without guessing, and a workspace can see what its invites earned.
ALTER TABLE referrals ADD COLUMN referrer_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE referrals ADD COLUMN referee_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE referrals ADD COLUMN revoked_at TEXT;
