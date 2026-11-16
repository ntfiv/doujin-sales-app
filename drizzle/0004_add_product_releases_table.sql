CREATE TABLE `product_releases` (
	`product` text PRIMARY KEY NOT NULL,
	`release_date` text NOT NULL DEFAULT '',
	`release_basis` text NOT NULL DEFAULT '',
	`release_confidence` text NOT NULL DEFAULT '',
	`discontinued` integer NOT NULL DEFAULT 0
);
