-- The communal bring list (#24), replacing the spreadsheet's "Bring" tab. An item is a name and
-- an optional comment; hands on it are what make it an offer rather than an ask, so there is no
-- kind column and no wanted count — visibility is the mechanism against two projectors, as it
-- was in the spreadsheet.
--
-- `bring_hand` keys on `attendance` for the reason `session_helper` does: only somebody coming
-- can carry the thing, and leaving the burn takes the pledge with it rather than leaving a name
-- nobody can reach. `author_account_id` is `set null` instead, since who asked outlives one burn.
CREATE TABLE `bring_item` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`author_account_id` text,
	`title` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`withdrawn_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `bring_item_pk` PRIMARY KEY(`id`),
	CONSTRAINT `bring_item_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT `bring_item_author_fk` FOREIGN KEY (`author_account_id`) REFERENCES `account`(`id`) ON DELETE set null,
	CONSTRAINT "bring_item_title_check" CHECK(length(trim("title")) > 0)
);
--> statement-breakpoint
CREATE INDEX `bring_item_event_idx` ON `bring_item` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bring_hand` (
	`item_id` text NOT NULL,
	`attendance_id` text NOT NULL,
	CONSTRAINT `bring_hand_pk` PRIMARY KEY(`item_id`, `attendance_id`),
	CONSTRAINT `bring_hand_item_fk` FOREIGN KEY (`item_id`) REFERENCES `bring_item`(`id`) ON DELETE cascade,
	CONSTRAINT `bring_hand_attendance_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE cascade
);
--> statement-breakpoint
-- A bring item is commentable, so it is a fifth entity type and five more categories — and four
-- tables are rebuilt rather than altered because each carries a CHECK listing a vocabulary, and
-- SQLite cannot alter one in place. The shape is `20260810210000_songbook`'s.
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
	CONSTRAINT "thread_entity_type_check" CHECK("entity_type" in ('session', 'attendance', 'post', 'song', 'bring'))
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
CREATE TABLE `__new_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	`seen_at` text,
	CONSTRAINT `fk_notification_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
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
	CONSTRAINT "activity_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
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
