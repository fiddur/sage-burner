-- The pantry (#805), replacing the spreadsheet's "Food inventory" and "Spice inventory" tabs:
-- what the house usually has, where it lives and roughly how much. `docs/food.md` has the why.
--
-- No `event_id`: the house keeps its stock between burns, the way the songbook keeps its songs.
--
-- The unique index is on `lower(trim(name))` and covers withdrawn rows too, so "oatmeal" and
-- "Oatmeal" cannot become two rows and a name taken off the list is restored rather than typed
-- again. `stock_amount` is only ever a number beside `'some'` — `'plenty'` and `'out'` are the
-- answers that need no counting.
CREATE TABLE `pantry_item` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`where` text DEFAULT '' NOT NULL,
	`stock_level` text,
	`stock_amount` real,
	`counted_by` text,
	`counted_at` text,
	`withdrawn_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `pantry_item_counted_by_fk` FOREIGN KEY (`counted_by`) REFERENCES `account`(`id`) ON DELETE SET NULL,
	CONSTRAINT "pantry_item_kind_check" CHECK("kind" in ('breakfast', 'snack', 'staple', 'spice', 'household')),
	CONSTRAINT "pantry_item_name_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "pantry_item_unit_check" CHECK(length(trim("unit")) > 0),
	CONSTRAINT "pantry_item_stock_level_check" CHECK("stock_level" is null or "stock_level" in ('plenty', 'some', 'out')),
	CONSTRAINT "pantry_item_stock_amount_check" CHECK("stock_amount" is null or ("stock_level" is 'some' and "stock_amount" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_item_name_idx` ON `pantry_item` (lower(trim("name")));--> statement-breakpoint
-- The starter list, in the spreadsheet's own words and its own order. Fixed ids so a fresh
-- install and an existing one agree about which row is which — these are seeded, not authored.
-- Nowhere and nothing counted: where a thing lives is this house's answer, not the software's.
INSERT INTO `pantry_item` (`id`, `kind`, `name`, `unit`, `where`, `created_at`) VALUES
	('fa0d0000-0000-4000-8000-000000000001', 'breakfast', 'Oatmeal', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000002', 'breakfast', 'Bread, hard', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000003', 'breakfast', 'Bread, hard, GF', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000004', 'breakfast', 'Bread, soft', 'pcs', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000005', 'breakfast', 'Bread, soft, GF', 'pcs', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000006', 'breakfast', 'Berries, frozen', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000007', 'breakfast', 'Müsli', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000008', 'breakfast', 'Corn flakes', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000009', 'breakfast', 'Soygurt', 'l', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-00000000000a', 'breakfast', 'Oat drink', 'l', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-00000000000b', 'breakfast', 'Coffee, ground', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-00000000000c', 'breakfast', 'Tea', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-00000000000d', 'snack', 'Tortillachips', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-00000000000e', 'snack', 'Dates', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-00000000000f', 'snack', 'Chocolate 70%', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000010', 'snack', 'Pop corn', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000011', 'snack', 'Apples', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000012', 'snack', 'Cashew', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000013', 'snack', 'Almonds', 'kg', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000014', 'household', 'Toilet paper', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000015', 'household', 'Candles, tea lights', 'pkt', '', '2026-09-18T00:00:00.000Z'),
	('fa0d0000-0000-4000-8000-000000000016', 'household', 'Dishwashing liquid', 'pcs', '', '2026-09-18T00:00:00.000Z');
