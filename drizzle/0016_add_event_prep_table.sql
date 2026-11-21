CREATE TABLE `event_prep` (
	`date` text PRIMARY KEY NOT NULL,
	`check_pop` integer DEFAULT 0 NOT NULL,
	`check_ticket` integer DEFAULT 0 NOT NULL,
	`check_packing` integer DEFAULT 0 NOT NULL,
	`start_time` text DEFAULT '' NOT NULL,
	`end_time` text DEFAULT '' NOT NULL,
	`space` text DEFAULT '' NOT NULL,
	`ticket_type` text DEFAULT '' NOT NULL,
	`guide_url` text DEFAULT '' NOT NULL
);
