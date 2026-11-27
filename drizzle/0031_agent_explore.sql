-- Vertov's own agent explores the app from a described goal before anything is recorded (kind 'explore'); the result is a
-- draft recipe the person reviews. goal and start_path are what they asked for, trace is the agent's compact action log,
-- live_key the latest exploration screenshot in R2, model_tokens the input and output tokens spent.
ALTER TABLE recorder_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'record';
ALTER TABLE recorder_jobs ADD COLUMN goal TEXT;
ALTER TABLE recorder_jobs ADD COLUMN start_path TEXT;
ALTER TABLE recorder_jobs ADD COLUMN trace TEXT;
ALTER TABLE recorder_jobs ADD COLUMN live_key TEXT;
ALTER TABLE recorder_jobs ADD COLUMN model_tokens TEXT;
