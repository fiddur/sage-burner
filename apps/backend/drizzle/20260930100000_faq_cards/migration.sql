-- FAQ questions as feed cards, the twelfth thread entity type; `docs/burns.md` has the why.
ALTER TABLE `faq_entry` ADD `author_account_id` text REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
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
	CONSTRAINT "thread_entity_type_check" CHECK("entity_type" in ('session', 'attendance', 'post', 'song', 'bring', 'point', 'meeting', 'role', 'meal', 'ride', 'build', 'faq'))
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
	CONSTRAINT "thread_entry_kind_check" CHECK("kind" in ('comment', 'offered', 'joined', 'introduced', 'posted', 'added', 'restored', 'facilitator', 'helper', 'renamed', 'scheduled', 'edited', 'withdrawn', 'raised', 'decided', 'asked', 'answered')),
	CONSTRAINT "thread_entry_comment_author_check" CHECK("kind" <> 'comment' or "author_account_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_thread_entry` (`id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`, `edited_at`)
SELECT `id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`, `edited_at` FROM `thread_entry`;
--> statement-breakpoint
DROP TABLE `thread_entry`;--> statement-breakpoint
ALTER TABLE `__new_thread_entry` RENAME TO `thread_entry`;--> statement-breakpoint
CREATE INDEX `thread_entry_seq_idx` ON `thread_entry` (`thread_id`,`seq`);--> statement-breakpoint
CREATE TABLE `__new_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	`seen_at` text,
	CONSTRAINT `fk_notification_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'ride_posted', 'ride_comment', 'ride_comment_any', 'build_added', 'build_role', 'build_comment', 'build_comment_any', 'faq_asked', 'faq_answered', 'faq_comment', 'faq_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'lead_role_comment', 'lead_role_comment_any', 'meal_taken', 'meal_comment', 'meal_comment_any', 'hearted', 'new_version', 'application', 'place_donated', 'application_news', 'payment_reminder'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'ride_posted', 'ride_comment', 'ride_comment_any', 'build_added', 'build_role', 'build_comment', 'build_comment_any', 'faq_asked', 'faq_answered', 'faq_comment', 'faq_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'lead_role_comment', 'lead_role_comment_any', 'meal_taken', 'meal_comment', 'meal_comment_any', 'hearted', 'new_version', 'application', 'place_donated', 'application_news', 'payment_reminder'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_setting` (`account_id`, `category`, `enabled`, `email`)
SELECT `account_id`, `category`, `enabled`, `email` FROM `notification_setting`;
--> statement-breakpoint
DROP TABLE `notification_setting`;--> statement-breakpoint
ALTER TABLE `__new_notification_setting` RENAME TO `notification_setting`;--> statement-breakpoint
INSERT INTO `thread` (`id`, `event_id`, `entity_type`, `entity_id`, `title`, `subject_account_id`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	`f`.`event_id`,
	'faq',
	`f`.`id`,
	`f`.`question`,
	NULL
FROM `faq_entry` `f`;
--> statement-breakpoint
INSERT INTO `thread_entry` (`id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`, `edited_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	`t`.`id`,
	'asked',
	1,
	NULL,
	'asked this',
	`f`.`created_at`,
	NULL
FROM `faq_entry` `f`
JOIN `thread` `t` ON `t`.`entity_type` = 'faq' AND `t`.`entity_id` = `f`.`id`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
