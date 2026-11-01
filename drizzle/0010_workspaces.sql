-- Workspaces: everyone in one shares a library and its pool of stored hours. Billing is per workspace, never per seat.
CREATE TABLE `workspaces` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  -- free, pro, team or business
  `plan` text DEFAULT 'free' NOT NULL,
  `plan_interval` text,
  -- active, past_due or canceling while a subscription is live; null on free
  `plan_status` text,
  `plan_period_end` text,
  -- Extra 50-hour blocks bought on top of the plan
  `extra_blocks` integer DEFAULT 0 NOT NULL,
  `polar_customer_id` text,
  `polar_subscription_id` text,
  `polar_extra_subscription_id` text,
  -- When a paid plan last ended; the library stays watchable but new recordings wait for room.
  `plan_ended_at` text,
  -- link: anyone with the link; workspace: signed-in members only. New videos start with this.
  `default_visibility` text DEFAULT 'link' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE `workspace_members` (
  `workspace_id` text NOT NULL,
  `user_id` text NOT NULL,
  -- owner, admin or member
  `role` text DEFAULT 'member' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY (`workspace_id`, `user_id`)
);
CREATE INDEX `idx_members_user` ON `workspace_members` (`user_id`);

-- Reusable invite links; the id is the secret in the link.
CREATE TABLE `workspace_invites` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `role` text DEFAULT 'member' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `expires_at` text NOT NULL,
  `revoked_at` text
);
CREATE INDEX `idx_invites_workspace` ON `workspace_invites` (`workspace_id`);

-- Shared libraries every member of the workspace can see.
CREATE TABLE `spaces` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
CREATE INDEX `idx_spaces_workspace` ON `spaces` (`workspace_id`);

-- A folder lives either in someone's own library (owner_id) or in a space (space_id).
CREATE TABLE `folders` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `space_id` text,
  `owner_id` text,
  `name` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
CREATE INDEX `idx_folders_workspace` ON `folders` (`workspace_id`);

ALTER TABLE `uploads` ADD `workspace_id` text;
ALTER TABLE `uploads` ADD `space_id` text;
ALTER TABLE `uploads` ADD `folder_id` text;
ALTER TABLE `uploads` ADD `archived_at` text;
ALTER TABLE `uploads` ADD `visibility` text DEFAULT 'link' NOT NULL;
-- ISO 639-1 code Whisper detected, reused as the hint for the owner's next recording.
ALTER TABLE `uploads` ADD `language` text;
-- Plain transcript text, so library search can match what was said.
ALTER TABLE `uploads` ADD `transcript_text` text;
-- Last view by someone other than the owner; drives free-plan retention.
ALTER TABLE `uploads` ADD `last_viewed_at` text;
ALTER TABLE `uploads` ADD `retention_notice_at` text;
ALTER TABLE `uploads` ADD `retention_final_at` text;
-- Removed for inactivity: hidden and unplayable, restorable until the files are purged.
ALTER TABLE `uploads` ADD `deleted_at` text;
-- Where an import came from (a Loom share URL), for old-link redirects.
ALTER TABLE `uploads` ADD `source_url` text;
CREATE INDEX `idx_uploads_workspace` ON `uploads` (`workspace_id`, `created_at`);
CREATE INDEX `idx_uploads_space` ON `uploads` (`space_id`);

-- Every existing account gets its own workspace holding its videos.
INSERT INTO `workspaces` (`id`, `name`, `created_by`)
  SELECT 'p_' || `id`, CASE WHEN trim(`name`) <> '' THEN trim(`name`) || '''s workspace' ELSE 'My workspace' END, `id` FROM `user`;
INSERT INTO `workspace_members` (`workspace_id`, `user_id`, `role`)
  SELECT 'p_' || `id`, `id`, 'owner' FROM `user`;
UPDATE `uploads` SET `workspace_id` = 'p_' || `owner_id` WHERE `owner_id` IS NOT NULL;
