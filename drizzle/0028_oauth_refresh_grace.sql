-- A refresh that arrives again within moments (two sessions sharing one connection, or a lost response) is answered with the
-- same tokens instead of failing: the previous refresh hash and the sealed last response are kept for a couple of minutes.
ALTER TABLE oauth_tokens ADD COLUMN prev_refresh_hash TEXT;
ALTER TABLE oauth_tokens ADD COLUMN last_response TEXT;
ALTER TABLE oauth_tokens ADD COLUMN rotated_at TEXT;
