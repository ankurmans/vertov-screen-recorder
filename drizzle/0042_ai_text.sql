-- JSON bookkeeping for the AI title, summary and chapters (src/lib/ai-text.server.ts): the edits they were written
-- against, the title as the AI wrote it, and text held back from viewers while it is being rewritten.
ALTER TABLE uploads ADD COLUMN ai_text TEXT;
