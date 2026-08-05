-- The host becomes the facilitator, and can be assigned (#198).
--
-- Two changes at once, which is why this is a rebuild rather than an
-- `ALTER TABLE … RENAME COLUMN`: the column is also losing `NOT NULL`, and SQLite
-- cannot drop a constraint in place. So it is the create-copy-drop-rename shape the
-- places migration uses.
--
-- **Every existing row keeps its value.** Whoever wrote a dream down was, in
-- practice, the person expected to run it — there was no way to say otherwise — so
-- carrying `host_account_id` across is the only reading that does not throw
-- information away. New dreams may leave it null.
--
-- The name change is the point of the rename: `host` said "whose dream this is",
-- which the route enforced by refusing the field in the body. Facilitator says "who
-- runs it", which is a thing one member hands to another.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`facilitator_account_id` text,
	`description` text DEFAULT '' NOT NULL,
	`time_slot_start` text,
	`time_slot_end` text,
	`place_id` text,
	CONSTRAINT "session_slot_whole_check" CHECK(("time_slot_start" is null) = ("time_slot_end" is null)),
	CONSTRAINT `fk_session_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT `fk_session_facilitator_account_id_account_id_fk` FOREIGN KEY (`facilitator_account_id`) REFERENCES `account`(`id`),
	CONSTRAINT `fk_session_place_id_place_id_fk` FOREIGN KEY (`place_id`) REFERENCES `place`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_session` (`id`, `event_id`, `title`, `facilitator_account_id`, `description`, `time_slot_start`, `time_slot_end`, `place_id`)
SELECT `id`, `event_id`, `title`, `host_account_id`, `description`, `time_slot_start`, `time_slot_end`, `place_id` FROM `session`;
--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;--> statement-breakpoint
CREATE INDEX `session_event_slot_idx` ON `session` (`event_id`,`time_slot_start`);
