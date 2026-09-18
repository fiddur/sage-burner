-- Places, and a spot per place (#814): the spreadsheet had a column per room and a box in each
-- cell, and inventory is done one room at a time. `docs/food.md` has the why.
--
-- `pantry_item_place.place_id` has no `ON DELETE`, so SQLite refuses to remove a room something
-- is still in and `pantry-places.ts` turns that into a 409 — the `account_allergy` rule, not the
-- `pantry_item_allergy` one: a spot is where the sack actually is, and dropping the room would
-- lose that rather than tidy it. `item_id` cascades, since a spot without its thing says nothing.
--
-- `pantry_item.where` is dropped, which SQLite can only do by rebuilding the table. The rebuild
-- carries every CHECK, both account references and the name index over, and `runMigrations` has
-- `foreign_keys = OFF` around it — so `DROP TABLE` does not cascade the hearts, the purchases,
-- the allergy tags, the ingredients or the spots inserted just above away. What any existing row
-- said is carried into a spot on a fifth place, "Somewhere", seeded only where such a row exists:
-- a free-text line cannot be sorted into rooms by the software, and an empty room in every
-- installation that never used the column would be furniture nobody asked for.
CREATE TABLE `pantry_place` (
	`id` text PRIMARY KEY NOT NULL,
	`order` integer NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "pantry_place_order_check" CHECK("order" >= 0),
	CONSTRAINT "pantry_place_name_check" CHECK(length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_place_name_idx` ON `pantry_place` (lower(trim("name")));--> statement-breakpoint
CREATE INDEX `pantry_place_order_idx` ON `pantry_place` (`order`);--> statement-breakpoint
INSERT INTO `pantry_place` (`id`, `order`, `name`) VALUES
	('fa0d0001-0000-4000-8000-000000000001', 0, 'Kitchen'),
	('fa0d0001-0000-4000-8000-000000000002', 1, 'Hallway'),
	('fa0d0001-0000-4000-8000-000000000003', 2, 'Cellar'),
	('fa0d0001-0000-4000-8000-000000000004', 3, 'Party kitchen');
--> statement-breakpoint
CREATE TABLE `pantry_item_place` (
	`item_id` text NOT NULL,
	`place_id` text NOT NULL,
	`spot` text DEFAULT '' NOT NULL,
	CONSTRAINT `pantry_item_place_pk` PRIMARY KEY(`item_id`, `place_id`),
	CONSTRAINT `pantry_item_place_item_fk` FOREIGN KEY (`item_id`) REFERENCES `pantry_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `pantry_item_place_place_fk` FOREIGN KEY (`place_id`) REFERENCES `pantry_place`(`id`)
);
--> statement-breakpoint
CREATE INDEX `pantry_item_place_place_idx` ON `pantry_item_place` (`place_id`);--> statement-breakpoint
INSERT INTO `pantry_place` (`id`, `order`, `name`)
SELECT 'fa0d0001-0000-4000-8000-000000000005', 4, 'Somewhere'
WHERE EXISTS (SELECT 1 FROM `pantry_item` WHERE trim(`where`) <> '');
--> statement-breakpoint
INSERT INTO `pantry_item_place` (`item_id`, `place_id`, `spot`)
SELECT `id`, 'fa0d0001-0000-4000-8000-000000000005', trim(`where`) FROM `pantry_item` WHERE trim(`where`) <> '';
--> statement-breakpoint
CREATE TABLE `__new_pantry_item` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`stock_level` text,
	`stock_amount` real,
	`counted_by` text,
	`counted_at` text,
	`need_more_by` text,
	`need_more_at` text,
	`withdrawn_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `pantry_item_counted_by_fk` FOREIGN KEY (`counted_by`) REFERENCES `account`(`id`) ON DELETE SET NULL,
	CONSTRAINT `pantry_item_need_more_by_fk` FOREIGN KEY (`need_more_by`) REFERENCES `account`(`id`) ON DELETE SET NULL,
	CONSTRAINT "pantry_item_kind_check" CHECK("kind" in ('breakfast', 'snack', 'staple', 'spice', 'household')),
	CONSTRAINT "pantry_item_name_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "pantry_item_unit_check" CHECK(length(trim("unit")) > 0),
	CONSTRAINT "pantry_item_stock_level_check" CHECK("stock_level" is null or "stock_level" in ('plenty', 'some', 'out')),
	CONSTRAINT "pantry_item_stock_amount_check" CHECK("stock_amount" is null or ("stock_level" is 'some' and "stock_amount" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_pantry_item` (`id`, `kind`, `name`, `unit`, `stock_level`, `stock_amount`, `counted_by`, `counted_at`, `need_more_by`, `need_more_at`, `withdrawn_at`, `created_at`)
SELECT `id`, `kind`, `name`, `unit`, `stock_level`, `stock_amount`, `counted_by`, `counted_at`, `need_more_by`, `need_more_at`, `withdrawn_at`, `created_at` FROM `pantry_item`;
--> statement-breakpoint
DROP TABLE `pantry_item`;--> statement-breakpoint
ALTER TABLE `__new_pantry_item` RENAME TO `pantry_item`;--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_item_name_idx` ON `pantry_item` (lower(trim("name")));
