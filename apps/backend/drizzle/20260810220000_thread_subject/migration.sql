-- A person's card is per person per burn, which is what `docs/the-app.md` already claimed and
-- the code did not do (#449). The thread was keyed on the attendance id alone, and leaving
-- deletes that row — so rejoining opened a second card and left the first saying "no longer
-- coming" about somebody who is. `subject_account_id` is what a card can be found by when the
-- stay it pointed at is gone; `entity_id` still carries the current stay, which is what decides
-- whether the card reads as gone.
ALTER TABLE `thread` ADD COLUMN `subject_account_id` text REFERENCES `account`(`id`) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `thread_subject_idx` ON `thread` (`subject_account_id`,`event_id`);--> statement-breakpoint
UPDATE `thread`
SET `subject_account_id` = (SELECT `account_id` FROM `attendance` WHERE `attendance`.`id` = `thread`.`entity_id`)
WHERE `entity_type` = 'attendance';
--> statement-breakpoint
-- The index did not match a single reader (#387): `readThreads` orders a thread's entries by
-- `seq`, `addEntry` reads the newest by `seq`, and the feed only groups by `thread_id`. Nothing
-- ordered by `created_at`.
DROP INDEX `thread_entry_recent_idx`;--> statement-breakpoint
CREATE INDEX `thread_entry_seq_idx` ON `thread_entry` (`thread_id`,`seq`);--> statement-breakpoint
-- Nothing reaches a post by its burn: the feed reads it through the thread, by id (#455).
DROP INDEX `post_event_idx`;
