-- Ingredients per sitting (#807): what a meal takes, written for any number of people, plus
-- `meal.serves` saying which number that is. `docs/food.md` has the why.
--
-- `serves` arrives as an `ALTER TABLE … ADD COLUMN` rather than a rebuild: the column is new and
-- carries a default, so no existing row has to be rewritten and no cascade is armed. SQLite takes
-- a CHECK in a column it is adding.
--
-- A line is either a pantry pick or a special buy, never both and never neither, which is what the
-- `<>` between the two `is null` tests says. A pick keeps no unit of its own — the pantry row's
-- unit is the one true answer, resolved at read time — and `pantry_item_id` has no `ON DELETE`
-- because taking a thing off the pantry list is soft, so the row it points at never goes away.
ALTER TABLE `meal` ADD COLUMN `serves` integer DEFAULT 1 NOT NULL CONSTRAINT `meal_serves_check` CHECK(`serves` >= 1);--> statement-breakpoint
CREATE TABLE `meal_ingredient` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`pantry_item_id` text,
	`name` text,
	`unit` text,
	`amount` real,
	`bought_by` text,
	`bought_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `meal_ingredient_meal_fk` FOREIGN KEY (`meal_id`) REFERENCES `meal`(`id`) ON DELETE CASCADE,
	CONSTRAINT `meal_ingredient_pantry_item_fk` FOREIGN KEY (`pantry_item_id`) REFERENCES `pantry_item`(`id`),
	CONSTRAINT `meal_ingredient_bought_by_fk` FOREIGN KEY (`bought_by`) REFERENCES `account`(`id`) ON DELETE SET NULL,
	CONSTRAINT "meal_ingredient_picked_or_written_check" CHECK(("pantry_item_id" is null) <> ("name" is null)),
	CONSTRAINT "meal_ingredient_written_check" CHECK("name" is null or (length(trim("name")) > 0 and length(trim(coalesce("unit", ''))) > 0)),
	CONSTRAINT "meal_ingredient_unit_check" CHECK("pantry_item_id" is null or "unit" is null),
	CONSTRAINT "meal_ingredient_amount_check" CHECK("amount" is null or "amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `meal_ingredient_meal_idx` ON `meal_ingredient` (`meal_id`);
