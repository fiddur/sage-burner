-- The songbook (#316): one shared book of what everybody sings, global rather than per burn,
-- because a song outlives any one gathering. `docs/the-app.md` has the reasoning.
--
-- `links` is JSON on the row rather than a table of its own: a link has no identity, nothing
-- refers to one, and the only operation is "replace the list". `author_account_id` is
-- `set null` for the same reason `post`'s is — the book survives somebody leaving.
CREATE TABLE `song` (
	`id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`capo` integer,
	`links` text DEFAULT '[]' NOT NULL,
	`author_account_id` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `song_pk` PRIMARY KEY(`id`),
	CONSTRAINT `song_author_fk` FOREIGN KEY (`author_account_id`) REFERENCES `account`(`id`) ON DELETE set null,
	CONSTRAINT "song_title_check" CHECK(length(trim("title")) > 0),
	CONSTRAINT "song_capo_check" CHECK("capo" is null or ("capo" >= 0 and "capo" <= 11))
);
--> statement-breakpoint
CREATE INDEX `song_title_idx` ON `song` (`title`);--> statement-breakpoint
CREATE TABLE `song_category` (
	`id` text NOT NULL,
	`order` integer NOT NULL,
	`label` text NOT NULL,
	CONSTRAINT `song_category_pk` PRIMARY KEY(`id`),
	CONSTRAINT "song_category_order_check" CHECK("order" >= 0),
	CONSTRAINT "song_category_label_check" CHECK(length(trim("label")) > 0)
);
--> statement-breakpoint
CREATE INDEX `song_category_order_idx` ON `song_category` (`order`);--> statement-breakpoint
-- Cascading both ways, unlike `account_allergy`: taking a category off the curated list should
-- unfile the songs in it rather than refuse, since nothing here is a claim about a person.
CREATE TABLE `song_in_category` (
	`song_id` text NOT NULL,
	`category_id` text NOT NULL,
	CONSTRAINT `song_in_category_pk` PRIMARY KEY(`song_id`, `category_id`),
	CONSTRAINT `song_in_category_song_fk` FOREIGN KEY (`song_id`) REFERENCES `song`(`id`) ON DELETE cascade,
	CONSTRAINT `song_in_category_category_fk` FOREIGN KEY (`category_id`) REFERENCES `song_category`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `song_in_category_category_idx` ON `song_in_category` (`category_id`);--> statement-breakpoint
INSERT INTO `song_category` (`id`, `order`, `label`)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
	),
	`order`, `label`
FROM (SELECT 0 AS `order`, 'Chant' AS `label` UNION ALL SELECT 1, 'Song');
--> statement-breakpoint
-- A song's thread belongs to no burn, so `thread.event_id` becomes nullable — and five tables
-- are rebuilt for the reason every earlier vocabulary change was: each carries a CHECK listing
-- one, and SQLite cannot alter a column or a constraint in place.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_thread` (
	`id` text NOT NULL,
	`event_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	CONSTRAINT `thread_pk` PRIMARY KEY(`id`),
	CONSTRAINT `thread_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT "thread_entity_type_check" CHECK("entity_type" in ('session', 'attendance', 'post', 'song'))
);
--> statement-breakpoint
INSERT INTO `__new_thread` (`id`, `event_id`, `entity_type`, `entity_id`, `title`)
SELECT `id`, `event_id`, `entity_type`, `entity_id`, `title` FROM `thread`;
--> statement-breakpoint
DROP TABLE `thread`;--> statement-breakpoint
ALTER TABLE `__new_thread` RENAME TO `thread`;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_entity_idx` ON `thread` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `thread_event_idx` ON `thread` (`event_id`);--> statement-breakpoint
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
	CONSTRAINT "thread_entry_kind_check" CHECK("kind" in ('comment', 'offered', 'joined', 'introduced', 'posted', 'added', 'restored', 'facilitator', 'helper', 'renamed', 'scheduled', 'edited', 'withdrawn')),
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
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
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
	CONSTRAINT "activity_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
);
--> statement-breakpoint
INSERT INTO `__new_activity` (`id`, `event_id`, `category`, `body`, `link`, `created_at`)
SELECT `id`, `event_id`, `category`, `body`, `link`, `created_at` FROM `activity`;
--> statement-breakpoint
DROP TABLE `activity`;--> statement-breakpoint
ALTER TABLE `__new_activity` RENAME TO `activity`;--> statement-breakpoint
CREATE INDEX `activity_recent_idx` ON `activity` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_event_idx` ON `activity` (`event_id`);
