ALTER TABLE `event_prep` ADD COLUMN `venue` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `event_prep` ADD COLUMN `check_announce` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `event_prep` ADD COLUMN `guide_by_mail` integer DEFAULT 0 NOT NULL;
