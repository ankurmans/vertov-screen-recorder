-- One rendered MP4 with the layout baked in, for downloads.
ALTER TABLE `uploads` ADD `export_key` text;
-- pending, done, failed.
ALTER TABLE `uploads` ADD `export_status` text;
-- Hash of the style and trim the export was rendered with; a mismatch means it's stale.
ALTER TABLE `uploads` ADD `export_signature` text;
