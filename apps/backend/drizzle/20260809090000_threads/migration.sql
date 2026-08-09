-- Comment threads on dreams, and a feed that collapses them into cards (#375).
--
-- `entity_id` carries no foreign key on purpose: a thread outlives what it is about,
-- because withdrawing a dream says so on the thread rather than deleting what people
-- said to each other. That is also why `event_id` and `title` are here — once the dream
-- is gone there is nothing left to join a burn or a name out of, and the feed still has
-- to draw the card. `schema.ts` has the rest.
CREATE TABLE `thread` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	CONSTRAINT `thread_pk` PRIMARY KEY(`id`),
	CONSTRAINT `thread_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT "thread_entity_type_check" CHECK("entity_type" in ('session'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_entity_idx` ON `thread` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `thread_event_idx` ON `thread` (`event_id`);--> statement-breakpoint
-- The author is an account rather than an attendance: leaving a burn empties your spots
-- and must not delete what you said. It is the actor on a system line too, which is what
-- lets a name be resolved on the read instead of being frozen into `body`.
CREATE TABLE `thread_entry` (
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
	CONSTRAINT "thread_entry_kind_check" CHECK("kind" in ('comment', 'offered', 'facilitator', 'helper', 'renamed', 'scheduled', 'edited', 'withdrawn')),
	CONSTRAINT "thread_entry_comment_author_check" CHECK("kind" <> 'comment' or "author_account_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `thread_entry_recent_idx` ON `thread_entry` (`thread_id`,`created_at`);--> statement-breakpoint
-- Every dream already offered gets its thread, so that the panel and the feed have one
-- to write to without a route deciding whether to create it first. No entries are
-- invented: an `activity` row carries a sentence and a `/dreams` link rather than a
-- session id, so nothing here can say who offered which dream or when. A thread with no
-- entries draws no card, and gets one the moment anything happens to the dream.
INSERT INTO `thread` (`id`, `event_id`, `entity_type`, `entity_id`, `title`)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
	),
	`event_id`, 'session', `id`, `title`
FROM `session`;
--> statement-breakpoint
-- Two categories more (#375), and three tables carry a CHECK listing the vocabulary.
-- SQLite cannot alter one in place, so all three are rebuilt — the same shape as the
-- rebuild #326 needed for `application`. Nothing is seeded into `notification_setting`:
-- one of the pair is on for somebody who has not said and one is off, and both defaults
-- live in `notificationCategoryInfo`.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	`seen_at` text,
	CONSTRAINT `fk_notification_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
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
	CONSTRAINT "activity_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
);
--> statement-breakpoint
INSERT INTO `__new_activity` (`id`, `event_id`, `category`, `body`, `link`, `created_at`)
SELECT `id`, `event_id`, `category`, `body`, `link`, `created_at` FROM `activity`;
--> statement-breakpoint
DROP TABLE `activity`;--> statement-breakpoint
ALTER TABLE `__new_activity` RENAME TO `activity`;--> statement-breakpoint
CREATE INDEX `activity_recent_idx` ON `activity` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_event_idx` ON `activity` (`event_id`);
