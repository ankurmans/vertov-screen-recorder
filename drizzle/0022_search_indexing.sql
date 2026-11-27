-- Opt-in search indexing per video. Off by default: share pages carry noindex unless the owner turns it on.
ALTER TABLE uploads ADD COLUMN search_indexing INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_uploads_search_indexing ON uploads(search_indexing) WHERE search_indexing = 1;
