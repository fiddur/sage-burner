-- Meetings and their talking points (#573), replacing the spreadsheet's meeting tab. A point is
-- addressed when it has a decision — no status column beside it to go stale, and clearing the
-- decision reopens the point. The discussion is the point's thread, so raising one puts a card on
-- the feed and recording a decision bumps it; `docs/meetings.md` has why.
--
-- `meeting` is scheduled rather than discussed: it has no thread, it is what the next-meeting
-- banner reads and what the calendar feed carries beside the dreams.
CREATE TABLE `meeting_point` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`author_account_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`decision` text,
	`decided_note` text,
	`created_at` text NOT NULL,
	CONSTRAINT `meeting_point_pk` PRIMARY KEY(`id`),
	CONSTRAINT `meeting_point_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT `meeting_point_author_fk` FOREIGN KEY (`author_account_id`) REFERENCES `account`(`id`) ON DELETE set null,
	CONSTRAINT "meeting_point_title_check" CHECK(length(trim("title")) > 0)
);
--> statement-breakpoint
CREATE INDEX `meeting_point_event_idx` ON `meeting_point` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `meeting` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`link` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `meeting_pk` PRIMARY KEY(`id`),
	CONSTRAINT `meeting_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT "meeting_title_check" CHECK(length(trim("title")) > 0),
	CONSTRAINT "meeting_run_check" CHECK("ends_at" is null or "ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE INDEX `meeting_event_idx` ON `meeting` (`event_id`,`starts_at`);--> statement-breakpoint
-- A talking point is commentable, so it is a sixth entity type, two more entry kinds and five more
-- categories — and five tables are rebuilt rather than altered because each carries a CHECK listing
-- a vocabulary, and SQLite cannot alter one in place. The shape is `20260812200000_bring_list`'s,
-- with `thread_entry` added to it for the two new kinds.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_thread` (
	`id` text NOT NULL,
	`event_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`subject_account_id` text REFERENCES `account`(`id`) ON DELETE set null,
	CONSTRAINT `thread_pk` PRIMARY KEY(`id`),
	CONSTRAINT `thread_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT "thread_entity_type_check" CHECK("entity_type" in ('session', 'attendance', 'post', 'song', 'bring', 'point'))
);
--> statement-breakpoint
INSERT INTO `__new_thread` (`id`, `event_id`, `entity_type`, `entity_id`, `title`, `subject_account_id`)
SELECT `id`, `event_id`, `entity_type`, `entity_id`, `title`, `subject_account_id` FROM `thread`;
--> statement-breakpoint
DROP TABLE `thread`;--> statement-breakpoint
ALTER TABLE `__new_thread` RENAME TO `thread`;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_entity_idx` ON `thread` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `thread_event_idx` ON `thread` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_subject_idx` ON `thread` (`subject_account_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `__new_thread_entry` (
	`id` text NOT NULL,
	`thread_id` text NOT NULL,
	`kind` text NOT NULL,
	`seq` integer NOT NULL,
	`author_account_id` text,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`edited_at` text,
	CONSTRAINT `thread_entry_pk` PRIMARY KEY(`id`),
	CONSTRAINT `thread_entry_thread_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE cascade,
	CONSTRAINT `thread_entry_author_fk` FOREIGN KEY (`author_account_id`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT "thread_entry_kind_check" CHECK("kind" in ('comment', 'offered', 'joined', 'introduced', 'posted', 'added', 'restored', 'facilitator', 'helper', 'renamed', 'scheduled', 'edited', 'withdrawn', 'raised', 'decided')),
	CONSTRAINT "thread_entry_comment_author_check" CHECK("kind" <> 'comment' or "author_account_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_thread_entry` (`id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`, `edited_at`)
SELECT `id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`, `edited_at` FROM `thread_entry`;
--> statement-breakpoint
DROP TABLE `thread_entry`;--> statement-breakpoint
ALTER TABLE `__new_thread_entry` RENAME TO `thread_entry`;--> statement-breakpoint
CREATE INDEX `thread_entry_recent_idx` ON `thread_entry` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	`seen_at` text,
	CONSTRAINT `fk_notification_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
);
--> statement-breakpoint
INSERT INTO `__new_notification` (`id`, `account_id`, `category`, `body`, `link`, `created_at`, `seen_at`)
SELECT `id`, `account_id`, `category`, `body`, `link`, `created_at`, `seen_at` FROM `notification`;
--> statement-breakpoint
DROP TABLE `notification`;--> statement-breakpoint
ALTER TABLE `__new_notification` RENAME TO `notification`;--> statement-breakpoint
CREATE INDEX `notification_account_idx` ON `notification` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_notification_setting` (
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`enabled` integer NOT NULL,
	`email` integer DEFAULT false NOT NULL,
	CONSTRAINT `notification_setting_pk` PRIMARY KEY(`account_id`, `category`),
	CONSTRAINT `fk_notification_setting_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_setting` (`account_id`, `category`, `enabled`, `email`)
SELECT `account_id`, `category`, `enabled`, `email` FROM `notification_setting`;
--> statement-breakpoint
DROP TABLE `notification_setting`;--> statement-breakpoint
ALTER TABLE `__new_notification_setting` RENAME TO `notification_setting`;--> statement-breakpoint
CREATE TABLE `__new_activity` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	CONSTRAINT `activity_pk` PRIMARY KEY(`id`),
	CONSTRAINT `activity_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT "activity_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
);
--> statement-breakpoint
INSERT INTO `__new_activity` (`id`, `event_id`, `category`, `body`, `link`, `created_at`)
SELECT `id`, `event_id`, `category`, `body`, `link`, `created_at` FROM `activity`;
--> statement-breakpoint
DROP TABLE `activity`;--> statement-breakpoint
ALTER TABLE `__new_activity` RENAME TO `activity`;--> statement-breakpoint
CREATE INDEX `activity_recent_idx` ON `activity` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_event_idx` ON `activity` (`event_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
