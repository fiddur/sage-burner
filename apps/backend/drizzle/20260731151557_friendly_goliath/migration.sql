PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`host_account_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`time_slot_start` text,
	`time_slot_end` text,
	`location` text,
	CONSTRAINT `fk_session_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_host_account_id_account_id_fk` FOREIGN KEY (`host_account_id`) REFERENCES `account`(`id`),
	CONSTRAINT "session_slot_whole_check" CHECK(("time_slot_start" is null) = ("time_slot_end" is null))
);
--> statement-breakpoint
INSERT INTO `__new_session`(`id`, `event_id`, `title`, `host_account_id`, `description`, `time_slot_start`, `time_slot_end`, `location`) SELECT `id`, `event_id`, `title`, `host_account_id`, `description`, `time_slot_start`, `time_slot_end`, `location` FROM `session`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `member_event_account_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `member_invite_token_idx`;--> statement-breakpoint
CREATE INDEX `session_event_slot_idx` ON `session` (`event_id`,`time_slot_start`);--> statement-breakpoint
DROP TABLE `member`;