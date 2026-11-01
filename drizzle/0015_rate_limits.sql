-- Fixed-window counters for abuse limits (guest sign-ups, request submissions).
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`bucket` integer NOT NULL,
	`n` integer NOT NULL DEFAULT 0,
	PRIMARY KEY(`key`, `bucket`)
);
