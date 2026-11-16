CREATE TABLE `product_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`canonical` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_merges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`canonical` text NOT NULL,
	`sources` text NOT NULL,
	`snapshot` text NOT NULL
);
