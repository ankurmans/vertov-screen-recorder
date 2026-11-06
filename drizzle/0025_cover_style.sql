-- How a workspace's automatic thumbnails look: "designed" (title, length, the best frame and the camera) or "frame".
ALTER TABLE workspaces ADD COLUMN cover_style TEXT NOT NULL DEFAULT 'designed';
