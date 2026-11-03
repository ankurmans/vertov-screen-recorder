CREATE TABLE IF NOT EXISTS lifecycle_preferences (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
 opted_out INTEGER NOT NULL DEFAULT 0,
 token TEXT NOT NULL UNIQUE,
 last_checked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lifecycle_sends (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 lesson TEXT NOT NULL,
 claimed_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'claimed',
 message_id TEXT,
 PRIMARY KEY(user_id, lesson)
);
CREATE INDEX IF NOT EXISTS lifecycle_recent ON lifecycle_sends(user_id, claimed_at);
CREATE INDEX IF NOT EXISTS lifecycle_status ON lifecycle_sends(status);
