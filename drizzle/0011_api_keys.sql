-- Personal API keys for agents, scripts and MCP clients. Each key acts as its user inside one workspace.
CREATE TABLE `api_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text NOT NULL,
  -- sha256 hex of the full key; the key itself is shown once and never stored
  `token_hash` text NOT NULL,
  -- first characters, so people can tell keys apart
  `prefix` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `last_used_at` text,
  `revoked_at` text
);
CREATE UNIQUE INDEX `idx_api_keys_hash` ON `api_keys` (`token_hash`);
CREATE INDEX `idx_api_keys_user` ON `api_keys` (`user_id`);
