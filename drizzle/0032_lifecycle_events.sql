-- Bounded product milestones, separate from optional analytics. No content or email addresses.
CREATE TABLE IF NOT EXISTS lifecycle_events (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 event TEXT NOT NULL CHECK(event IN ('recorded','imported','shared','viewed','active')),
 first_at INTEGER NOT NULL,
 last_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,event)
);
