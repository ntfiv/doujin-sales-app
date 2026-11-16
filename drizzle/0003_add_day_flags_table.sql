CREATE TABLE `day_flags` (
	`date` text PRIMARY KEY NOT NULL,
	`sales_unreliable` integer DEFAULT 0 NOT NULL,
	`has_new_release` integer DEFAULT 0 NOT NULL,
	`new_release_note` text DEFAULT '' NOT NULL
);
