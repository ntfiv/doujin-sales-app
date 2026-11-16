CREATE TABLE `inventory_memos` (
	`date` text PRIMARY KEY NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`memo` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`product` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_date_product_idx` ON `inventory_items` (`date`,`product`);
