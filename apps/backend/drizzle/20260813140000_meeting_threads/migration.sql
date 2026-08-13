-- A meeting becomes a feed card (#597), the seventh thread entity type. It was an `activity`
-- line with the pre-#480 chip: the one thing on the feed nobody could reply to, which is backwards
-- for the thing most likely to need "I can't make that time".
--
-- `author_account_id` is added because a card says whose it is and `participantsOf` needs somebody
-- to call the author — `meeting` had no such column, having been a row nobody talked about. Rows
-- written before this keep a null one, exactly as a post whose author has left does.
--
-- `thread_entry` is *not* rebuilt: `scheduled` and `comment` are both already in its vocabulary.
ALTER TABLE `meeting` ADD COLUMN `author_account_id` text REFERENCES `account`(`id`) ON DELETE set null;--> statement-breakpoint
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
	CONSTRAINT "thread_entity_type_check" CHECK("entity_type" in ('session', 'attendance', 'post', 'song', 'bring', 'point', 'meeting'))
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
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
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
	CONSTRAINT "activity_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application', 'application_news'))
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
