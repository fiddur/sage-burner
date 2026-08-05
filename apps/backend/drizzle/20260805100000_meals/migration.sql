-- Meal planning (#210).
--
-- `meal_slot` is the burn's configuration — Lunch at 13:00, Dinner at 18:00, and
-- for some burns a Morning cleanup at 09:00, which is why a slot carries a kind.
--
-- **There is no meal table.** A meal is a slot on a date, and both already exist:
-- the slot is configured and the date comes from the burn's own span. Storing them
-- would mean reconciling every time either changed, so `meal_role` references the
-- slot and carries the date instead.
--
-- The kitchen is **not** a place. It is a lane the schedule draws itself, from the
-- slots, and nothing else can be put in it — which is the point: the kitchen is for
-- cooking, fetching food and washing up, and a lane anybody could drop a dream into
-- would not stay that way. A burn with no slots gets no lane.
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
CREATE TABLE `meal_role` (
	`slot_id` text NOT NULL,
	`date` text NOT NULL,
	`attendance_id` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT `meal_role_pk` PRIMARY KEY(`slot_id`, `date`, `attendance_id`, `role`),
	CONSTRAINT `fk_meal_role_slot_id_meal_slot_id_fk` FOREIGN KEY (`slot_id`) REFERENCES `meal_slot`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_meal_role_attendance_id_attendance_id_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE,
	CONSTRAINT "meal_role_role_check" CHECK("role" in ('lead', 'helper', 'cleanup')),
	CONSTRAINT "meal_role_date_check" CHECK("date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
-- One lead per sitting. The other two are unbounded: nothing runs out of people
-- willing to wash up, and a cap would only be something for an organiser to raise.
CREATE UNIQUE INDEX `meal_role_lead_idx` ON `meal_role` (`slot_id`,`date`) WHERE "role" = 'lead';--> statement-breakpoint
-- The sheet's "Food idea?" column, whose own header says "Not needed". A row only
-- where somebody wrote one — most sittings never get an idea.
CREATE TABLE `meal_note` (
	`slot_id` text NOT NULL,
	`date` text NOT NULL,
	`food_idea` text NOT NULL,
	CONSTRAINT `meal_note_pk` PRIMARY KEY(`slot_id`, `date`),
	CONSTRAINT `fk_meal_note_slot_id_meal_slot_id_fk` FOREIGN KEY (`slot_id`) REFERENCES `meal_slot`(`id`) ON DELETE CASCADE,
	CONSTRAINT "meal_note_date_check" CHECK("date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
