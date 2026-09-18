-- Hearts on the pantry and the ticks on the shopping list (#806). `docs/food.md` has the why.
--
-- A heart is keyed on `attendance`, not on the account, exactly as a bring-list hand is:
-- leaving the burn withdraws the heart, and "14 want it" means fourteen of the people coming.
--
-- A tick is a row rather than a column on `pantry_item`, because the item belongs to no burn
-- and the buying does: one row per `(event, item)`, so the same oatmeal is bought again next
-- time. Being a row on the server is also what lets the list survive the phone that ticked it
-- and lets two people in the same shop see each other's ticks. `bought_by` goes null with the
-- account and `bought_at` stays: the burn still bought the thing.
CREATE TABLE `pantry_heart` (
	`item_id` text NOT NULL,
	`attendance_id` text NOT NULL,
	CONSTRAINT `pantry_heart_pk` PRIMARY KEY(`item_id`, `attendance_id`),
	CONSTRAINT `pantry_heart_item_fk` FOREIGN KEY (`item_id`) REFERENCES `pantry_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `pantry_heart_attendance_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pantry_purchase` (
	`event_id` text NOT NULL,
	`item_id` text NOT NULL,
	`bought_by` text,
	`bought_at` text NOT NULL,
	CONSTRAINT `pantry_purchase_pk` PRIMARY KEY(`event_id`, `item_id`),
	CONSTRAINT `pantry_purchase_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `pantry_purchase_item_fk` FOREIGN KEY (`item_id`) REFERENCES `pantry_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `pantry_purchase_bought_by_fk` FOREIGN KEY (`bought_by`) REFERENCES `account`(`id`) ON DELETE SET NULL
);
