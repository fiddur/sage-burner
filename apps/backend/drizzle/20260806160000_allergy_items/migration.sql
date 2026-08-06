-- Allergies as a list of items, beside the free text rather than instead of it (#254).
--
-- Global rather than per burn: what somebody cannot eat is a fact about them, and a
-- per-burn list would mean re-ticking it every time. Rows rather than an enum so an
-- admin adds one without a deploy.
--
-- `account_allergy.item_id` has **no** `ON DELETE`, so SQLite refuses to remove an
-- item somebody has ticked. Cascading would silently drop a row that exists to keep
-- somebody safe; a wrong label is renamed, not deleted.
--
-- Nothing is migrated out of `account.allergies_notes`. It stays exactly as it is and
-- becomes the "Other" field beside the ticks — parsing free text into items would be
-- a guess, on the one kind of data where a wrong guess matters.
CREATE TABLE `allergy_item` (
	`id` text PRIMARY KEY NOT NULL,
	`order` integer NOT NULL,
	`label` text NOT NULL,
	CONSTRAINT "allergy_item_order_check" CHECK("order" >= 0),
	CONSTRAINT "allergy_item_label_check" CHECK(length(trim("label")) > 0)
);
--> statement-breakpoint
CREATE INDEX `allergy_item_order_idx` ON `allergy_item` (`order`);--> statement-breakpoint
CREATE TABLE `account_allergy` (
	`account_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`account_id`, `item_id`),
	CONSTRAINT `fk_account_allergy_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT `fk_account_allergy_item_id_allergy_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `allergy_item`(`id`)
);
--> statement-breakpoint
-- Fredrik's five, in the order he wrote them. Fixed ids so a fresh install and an
-- existing one agree about which row is which — these are seeded, not authored.
INSERT INTO `allergy_item` (`id`, `order`, `label`) VALUES
	('a11e0000-0000-4000-8000-000000000001', 0, 'Vegan'),
	('a11e0000-0000-4000-8000-000000000002', 1, 'Gluten (non-celiac)'),
	('a11e0000-0000-4000-8000-000000000003', 2, 'Strict gluten (celiac)'),
	('a11e0000-0000-4000-8000-000000000004', 3, 'Lactose'),
	('a11e0000-0000-4000-8000-000000000005', 4, 'Milk protein');
