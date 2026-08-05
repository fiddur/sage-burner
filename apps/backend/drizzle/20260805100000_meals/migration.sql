-- Meal planning (#210).
--
-- `meal_slot` is the template an organiser sets once per burn — Lunch at 13:00,
-- Dinner at 18:00, and for some burns a Morning cleanup at 09:00, which is why a slot
-- carries a kind. `meal` is what generating from those templates writes.
--
-- **Generated, not derived.** A derived meal is identical to its template forever:
-- there would be no postponing Saturday's dinner, no dropping lunch on the day
-- everybody leaves, no adding a late supper. Rows can be changed one at a time, and
-- every change is then a visible edit rather than a rule that has to be read to be
-- understood.
--
-- The slot's values are copied and there is no link back. Renaming a slot leaves the
-- meals it already made alone — the same call the repeatable dream makes about its
-- copies.
--
-- The kitchen is deliberately **not** a place. It is a lane the schedule draws itself,
-- so nothing but cooking, fetching food and washing up can be put in it, and a burn
-- with no meals gets no lane.
ALTER TABLE `event` ADD `meal_intro_markdown` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE `meal_slot` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`order` integer NOT NULL,
	`label` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT `fk_meal_slot_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT "meal_slot_order_check" CHECK("order" >= 0),
	CONSTRAINT "meal_slot_label_check" CHECK(length(trim("label")) > 0),
	CONSTRAINT "meal_slot_at_check" CHECK("at" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("at", 1, 2) as integer) < 24),
	CONSTRAINT "meal_slot_kind_check" CHECK("kind" in ('meal', 'chore'))
);
--> statement-breakpoint
CREATE INDEX `meal_slot_event_idx` ON `meal_slot` (`event_id`,`order`);--> statement-breakpoint
CREATE TABLE `meal` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`date` text NOT NULL,
	`at` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`food_idea` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_meal_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT "meal_label_check" CHECK(length(trim("label")) > 0),
	CONSTRAINT "meal_at_check" CHECK("at" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("at", 1, 2) as integer) < 24),
	CONSTRAINT "meal_kind_check" CHECK("kind" in ('meal', 'chore')),
	CONSTRAINT "meal_date_check" CHECK("date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `meal_event_idx` ON `meal` (`event_id`,`date`,`at`);--> statement-breakpoint
-- What makes generating safe to run again: it fills in what is missing and touches
-- nothing else, so adding a slot or extending the burn is one click and never a
-- duplicate. Two lunches on one day is a mistake, not a plan.
CREATE UNIQUE INDEX `meal_event_date_label_idx` ON `meal` (`event_id`,`date`,`label`);--> statement-breakpoint
CREATE TABLE `meal_role` (
	`meal_id` text NOT NULL,
	`attendance_id` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT `meal_role_pk` PRIMARY KEY(`meal_id`, `attendance_id`, `role`),
	CONSTRAINT `fk_meal_role_meal_id_meal_id_fk` FOREIGN KEY (`meal_id`) REFERENCES `meal`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_meal_role_attendance_id_attendance_id_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE,
	CONSTRAINT "meal_role_role_check" CHECK("role" in ('lead', 'helper', 'cleanup'))
);
--> statement-breakpoint
-- One lead per meal. The other two are unbounded: nothing runs out of people willing
-- to wash up, and a cap would only be something for an organiser to raise.
CREATE UNIQUE INDEX `meal_role_lead_idx` ON `meal_role` (`meal_id`) WHERE "role" = 'lead';
