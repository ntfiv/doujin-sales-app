UPDATE `events` SET `event_type` = '' WHERE `event_type` NOT IN ('comiket', 'comitia', 'designfesta', 'bungaku', 'zinefes', 'comiccity', 'sunshine', 'omobaza', 'touhou', 'techbook', 'other');
--> statement-breakpoint
DELETE FROM `event_types`;
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('comiket', 'コミックマーケット', 'コミックマーケット,コミケ', 0);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('comitia', 'コミティア系', 'コミティア', 1);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('designfesta', 'デザインフェスタ', 'デザインフェスタ,デザフェス', 2);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('bungaku', '文学フリマ系', '文学フリマ,文フリ', 3);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('zinefes', 'ZINEフェス', 'ZINEフェス', 4);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('comiccity', 'COMIC CITY系', 'COMIC CITY,コミックシティ,SUPER COMIC CITY', 5);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('sunshine', 'サンシャインクリエイション', 'サンシャインクリエイション', 6);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('omobaza', 'おもバザ', 'おもバザ,おもしろ同人誌バザール', 7);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('touhou', '例大祭・東方系', '例大祭,東方', 8);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('techbook', '技術書典', '技術書典', 9);
--> statement-breakpoint
INSERT INTO `event_types` (`key`, `label`, `keywords`, `sort_order`) VALUES ('other', 'その他', '', 10);
