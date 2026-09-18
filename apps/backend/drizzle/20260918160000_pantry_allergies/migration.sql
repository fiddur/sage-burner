-- Allergy tags on a pantry thing (#808): "this contains that", so a sitting can say who among
-- the people there that day cannot eat one of its ingredients. `docs/food.md` has the why.
--
-- `account_allergy` has no `ON DELETE` on its `allergy_item` reference, so SQLite refuses to
-- drop a vocabulary item somebody has ticked and `allergies.ts` turns that into a 409. Here it
-- cascades instead: a tag on a pantry row is not somebody's statement about themselves, so
-- retiring "Nuts" from the vocabulary takes the tags with it rather than being refused.
CREATE TABLE `pantry_item_allergy` (
	`item_id` text NOT NULL,
	`allergy_item_id` text NOT NULL,
	CONSTRAINT `pantry_item_allergy_pk` PRIMARY KEY(`item_id`, `allergy_item_id`),
	CONSTRAINT `pantry_item_allergy_item_fk` FOREIGN KEY (`item_id`) REFERENCES `pantry_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `pantry_item_allergy_allergy_fk` FOREIGN KEY (`allergy_item_id`) REFERENCES `allergy_item`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `pantry_item_allergy_allergy_idx` ON `pantry_item_allergy` (`allergy_item_id`);
