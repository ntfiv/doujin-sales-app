CREATE TABLE `product_series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_series_name_idx` ON `product_series` (`name`);
--> statement-breakpoint
CREATE TABLE `product_series_members` (
	`series_id` integer NOT NULL,
	`product` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_series_members_idx` ON `product_series_members` (`series_id`, `product`);
