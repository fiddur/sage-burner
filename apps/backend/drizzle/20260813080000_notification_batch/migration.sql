-- One row per notification generated (#575), so an organiser can answer "did that actually reach
-- anybody" instead of reading the container log. A fan-out to thirty attendees is one row here and
-- thirty in `notification`: the counters are accumulated as the fan-out runs, one UPSERT per
-- account, which is why every count column carries a default of 0.
--
-- `accepted` is what the push service took, never what a device showed — a push message is gone the
-- moment it is dismissed and nothing acknowledges it. `docs/accounts.md` says what each column can
-- and cannot claim.
--
-- No CHECK on `category`, unlike `notification`, `notification_setting` and `activity`. Those three
-- are rebuilt by every migration that widens the vocabulary; a fifth would tax the same change
-- again for a table nobody writes into but this process, and a log whose write can fail because the
-- vocabulary moved on is worse than a log holding a category the app no longer uses.
CREATE TABLE `notification_batch` (
	`id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	`told` integer DEFAULT 0 NOT NULL,
	`suppressed` integer DEFAULT 0 NOT NULL,
	`emailed` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`gone` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `notification_batch_pk` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `notification_batch_idx` ON `notification_batch` (`created_at`);
