-- Viewer events carry their workspace so insights can read them from a database that holds no uploads table.
ALTER TABLE view_events ADD COLUMN workspace_id TEXT;
ALTER TABLE view_progress ADD COLUMN workspace_id TEXT;
UPDATE view_events SET workspace_id = (SELECT workspace_id FROM uploads WHERE uploads.id = view_events.upload_id);
UPDATE view_progress SET workspace_id = (SELECT workspace_id FROM uploads WHERE uploads.id = view_progress.upload_id);
CREATE INDEX IF NOT EXISTS idx_view_events_workspace ON view_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_view_progress_workspace ON view_progress(workspace_id);
