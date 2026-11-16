DROP TABLE `product_series_members`;
--> statement-breakpoint
DROP TABLE `product_series`;
--> statement-breakpoint
ALTER TABLE `day_flags` DROP COLUMN `has_new_release`;
--> statement-breakpoint
ALTER TABLE `day_flags` DROP COLUMN `new_release_note`;
--> statement-breakpoint
ALTER TABLE `product_releases` DROP COLUMN `release_confidence`;
