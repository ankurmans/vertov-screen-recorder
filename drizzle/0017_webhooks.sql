-- Outgoing webhooks: per-workspace endpoints and a delivery log.
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`disabled_at` text
);
CREATE INDEX `idx_webhook_endpoints_workspace` ON `webhook_endpoints` (`workspace_id`);
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`event` text NOT NULL,
	`status` integer,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
CREATE INDEX `idx_webhook_deliveries_endpoint` ON `webhook_deliveries` (`endpoint_id`, `created_at`);
