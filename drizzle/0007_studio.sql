-- Camera recorded as its own track and composited at playback, so the layout can change after recording.
ALTER TABLE `uploads` ADD `camera_key` text;
ALTER TABLE `uploads` ADD `camera_content_type` text;
ALTER TABLE `uploads` ADD `camera_multipart_upload_id` text;
-- monitor, window, browser or camera: what the screen track captured.
ALTER TABLE `uploads` ADD `capture_surface` text;
-- JSON: { layout, corner, size, shape, background }.
ALTER TABLE `uploads` ADD `style` text;
ALTER TABLE `uploads` ADD `trim_start` real;
ALTER TABLE `uploads` ADD `trim_end` real;
ALTER TABLE `uploads` ADD `cta_label` text;
ALTER TABLE `uploads` ADD `cta_url` text;

-- Parts are now per track; rows are transient (deleted on completion), so recreate.
DROP TABLE `upload_parts`;
CREATE TABLE `upload_parts` (
  `upload_id` text NOT NULL,
  `track` text NOT NULL DEFAULT 'screen',
  `part_number` integer NOT NULL,
  `etag` text NOT NULL,
  `size` integer NOT NULL,
  PRIMARY KEY (`upload_id`, `track`, `part_number`)
);

-- Emoji reactions pinned to a moment, replayed over the video as it passes.
CREATE TABLE `reactions` (
  `id` text PRIMARY KEY NOT NULL,
  `upload_id` text NOT NULL,
  `viewer_id` text NOT NULL,
  `viewer_name` text,
  `emoji` text NOT NULL,
  `timestamp` real NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
CREATE INDEX `idx_reactions_upload` ON `reactions` (`upload_id`);

-- How far each viewer got, for the owner's insights.
CREATE TABLE `view_progress` (
  `upload_id` text NOT NULL,
  `viewer_key` text NOT NULL,
  `viewer_name` text,
  `viewer_avatar` text,
  `percent` real NOT NULL DEFAULT 0,
  `seconds` real NOT NULL DEFAULT 0,
  `country` text,
  `city` text,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY (`upload_id`, `viewer_key`)
);
