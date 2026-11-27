ALTER TABLE uploads ADD COLUMN password_hash text;
ALTER TABLE uploads ADD COLUMN expires_at text;
ALTER TABLE uploads ADD COLUMN downloads_enabled integer NOT NULL DEFAULT 1;
ALTER TABLE uploads ADD COLUMN cuts text;
