-- A dream with a time has a lane. Choosing "Nowhere yet" in the panel took a dream off
-- the grid and left its time on the row, so the calendar feed went on carrying it for
-- weeks after the schedule had dropped it. The routes clear the slot with the lane now,
-- and the CHECK makes the state unwritable; the copy below is the same rule applied to
-- the rows already in it.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`facilitator_attendance_id` text,
	`description` text DEFAULT '' NOT NULL,
	`repeatable` integer DEFAULT false NOT NULL,
	`time_slot_start` text,
	`time_slot_end` text,
	`place_id` text,
	`withdrawn_at` text,
	`merged_into_id` text,
	CONSTRAINT "session_slot_whole_check" CHECK(("time_slot_start" is null) = ("time_slot_end" is null)),
	CONSTRAINT "session_slot_needs_lane_check" CHECK(("place_id" is not null) or ("time_slot_start" is null)),
	CONSTRAINT `fk_session_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT `fk_session_facilitator_attendance_id_attendance_id_fk` FOREIGN KEY (`facilitator_attendance_id`) REFERENCES `attendance`(`id`) ON DELETE set null,
	CONSTRAINT `fk_session_place_id_place_id_fk` FOREIGN KEY (`place_id`) REFERENCES `place`(`id`),
	CONSTRAINT `fk_session_merged_into_id_session_id_fk` FOREIGN KEY (`merged_into_id`) REFERENCES `session`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_session` (`id`, `event_id`, `title`, `facilitator_attendance_id`, `description`, `repeatable`, `time_slot_start`, `time_slot_end`, `place_id`, `withdrawn_at`, `merged_into_id`)
SELECT
	`id`,
	`event_id`,
	`title`,
	`facilitator_attendance_id`,
	`description`,
	`repeatable`,
	CASE WHEN `place_id` IS NULL THEN NULL ELSE `time_slot_start` END,
	CASE WHEN `place_id` IS NULL THEN NULL ELSE `time_slot_end` END,
	`place_id`,
	`withdrawn_at`,
	`merged_into_id`
FROM `session`;
--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;--> statement-breakpoint
CREATE INDEX `session_event_slot_idx` ON `session` (`event_id`,`time_slot_start`);
