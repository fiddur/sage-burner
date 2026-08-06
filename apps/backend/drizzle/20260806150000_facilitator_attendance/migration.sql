-- A dream is facilitated by somebody attending, not by an account (#23).
--
-- Leaving a burn now takes you off everything you had signed up for there. Every
-- other role already held that by foreign key — helping ticks, meal shifts,
-- lead teams, dream helpers all hang off `attendance` and cascade — and the
-- facilitator was the one exception, deliberately: the old column comment said a
-- withdrawal "leaves the name here for somebody to notice". #247 gave the spot a
-- take-it control, so a vacancy is now something a reader can act on rather than
-- something to be warned about, and Fredrik's call is that leaving clears it.
--
-- `set null`, not cascade: the dream outlives whoever was going to run it.
--
-- **The backfill is the point.** Unlike the `attendance` rebuild noted in
-- `schema.ts`, this table has rows on the live database, so the correlated subquery
-- maps each facilitator to their attendance *at that dream's own burn*. A
-- facilitator who is not attending resolves to NULL — which is the new rule applied
-- to existing rows, not data lost.
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
	CONSTRAINT "session_slot_whole_check" CHECK(("time_slot_start" is null) = ("time_slot_end" is null)),
	CONSTRAINT `fk_session_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT `fk_session_facilitator_attendance_id_attendance_id_fk` FOREIGN KEY (`facilitator_attendance_id`) REFERENCES `attendance`(`id`) ON DELETE set null,
	CONSTRAINT `fk_session_place_id_place_id_fk` FOREIGN KEY (`place_id`) REFERENCES `place`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_session` (`id`, `event_id`, `title`, `facilitator_attendance_id`, `description`, `repeatable`, `time_slot_start`, `time_slot_end`, `place_id`)
SELECT
	`session`.`id`,
	`session`.`event_id`,
	`session`.`title`,
	(SELECT `attendance`.`id` FROM `attendance`
	  WHERE `attendance`.`event_id` = `session`.`event_id`
	    AND `attendance`.`account_id` = `session`.`facilitator_account_id`),
	`session`.`description`,
	`session`.`repeatable`,
	`session`.`time_slot_start`,
	`session`.`time_slot_end`,
	`session`.`place_id`
FROM `session`;
--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;--> statement-breakpoint
CREATE INDEX `session_event_slot_idx` ON `session` (`event_id`,`time_slot_start`);
