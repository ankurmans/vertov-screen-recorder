-- Viewer email gate, watch later, branding, Slack, retention policy, privacy, audit log, SCIM, AI documents.
ALTER TABLE `uploads` ADD `require_email` integer DEFAULT 0 NOT NULL;
ALTER TABLE `uploads` ADD `ai_docs` text;
CREATE TABLE `viewer_emails` (
	`upload_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`upload_id`, `email`)
);
CREATE TABLE `watch_later` (
	`user_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `upload_id`)
);
ALTER TABLE `workspaces` ADD `brand_color` text;
ALTER TABLE `workspaces` ADD `brand_logo_key` text;
ALTER TABLE `workspaces` ADD `slack_webhook` text;
ALTER TABLE `workspaces` ADD `retention_days` integer;
ALTER TABLE `workspaces` ADD `allowed_domains` text;
ALTER TABLE `workspaces` ADD `downloads_default` integer DEFAULT 1 NOT NULL;
ALTER TABLE `workspaces` ADD `scim_token_hash` text;
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
CREATE INDEX `idx_audit_workspace` ON `audit_log` (`workspace_id`, `created_at`);
