-- Voiceover: a workspace's own ElevenLabs key (encrypted) and one generated narration track per video.
ALTER TABLE workspaces ADD COLUMN eleven_key TEXT;
ALTER TABLE uploads ADD COLUMN voice_key TEXT;
ALTER TABLE uploads ADD COLUMN voice_text TEXT;
ALTER TABLE uploads ADD COLUMN voice_voice_id TEXT;
ALTER TABLE uploads ADD COLUMN voice_voice_name TEXT;
ALTER TABLE uploads ADD COLUMN voice_model TEXT;
-- Seconds into the source recording where the narration starts.
ALTER TABLE uploads ADD COLUMN voice_offset REAL NOT NULL DEFAULT 0;
