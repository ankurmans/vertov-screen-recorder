-- "Request a video": a link that lets anyone record into a workspace without an account.
CREATE TABLE `video_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`title` text NOT NULL,
	`message` text,
	`space_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
CREATE INDEX `idx_requests_workspace` ON `video_requests` (`workspace_id`);
ALTER TABLE `uploads` ADD `request_id` text;
CREATE INDEX `idx_uploads_request` ON `uploads` (`request_id`);
