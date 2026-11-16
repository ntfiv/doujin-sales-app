CREATE TABLE `master_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`event_name` text DEFAULT '' NOT NULL,
	`venue` text DEFAULT '' NOT NULL,
	`prefecture` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
