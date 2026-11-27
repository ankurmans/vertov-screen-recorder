-- Per-user preferences. `language` is the app UI language (see src/lib/i18n/languages.ts); null follows the browser.
-- Validated in code, not by a CHECK, so adding a language needs no migration.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  language TEXT,
  updated_at TEXT NOT NULL
);
