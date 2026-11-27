-- Why a finished recording differs from what was asked, e.g. silent because the workspace had no voice credits.
ALTER TABLE recorder_jobs ADD COLUMN note TEXT;
