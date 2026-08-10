-- One category for being named in something somebody wrote (#439). Three tables rebuilt, all
-- for the same reason as before: each carries a CHECK listing `notificationCategories`, and
-- SQLite cannot alter one in place.
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
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
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
	CONSTRAINT "activity_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
);
--> statement-breakpoint
INSERT INTO `__new_activity` (`id`, `event_id`, `category`, `body`, `link`, `created_at`)
SELECT `id`, `event_id`, `category`, `body`, `link`, `created_at` FROM `activity`;
--> statement-breakpoint
DROP TABLE `activity`;--> statement-breakpoint
ALTER TABLE `__new_activity` RENAME TO `activity`;--> statement-breakpoint
CREATE INDEX `activity_recent_idx` ON `activity` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_event_idx` ON `activity` (`event_id`);