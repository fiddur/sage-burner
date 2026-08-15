-- A heart says so now (#706). #693 decided against it deliberately — "a `hearted` category, if
-- ever wanted, is its own issue" — and it is wanted: a heart was the one thing anybody could do on
-- the feed that reached nobody, so it was news only to whoever went back and looked.
--
-- One category rather than the `_comment`/`_comment_any` pair every card kind has. Nobody wants
-- every heart on the burn, and a heart is the same small thing wherever it lands, so one switch
-- covers it. `about: 'you'` and on by default, which is what the standard says of anything that
-- happens *to* you.
--
-- Both tables are rebuilt because both CHECK the whole vocabulary. No backfill: absence in
-- `notification_setting` already means "has not said", and `notificationCategoryInfo` decides what
-- that means — so nobody's stored choices are touched and the default arrives on its own.
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
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'lead_role_comment', 'lead_role_comment_any', 'meal_taken', 'meal_comment', 'meal_comment_any', 'hearted', 'new_version', 'application', 'application_news'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'lead_role_comment', 'lead_role_comment_any', 'meal_taken', 'meal_comment', 'meal_comment_any', 'hearted', 'new_version', 'application', 'application_news'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_setting` (`account_id`, `category`, `enabled`, `email`)
SELECT `account_id`, `category`, `enabled`, `email` FROM `notification_setting`;
--> statement-breakpoint
DROP TABLE `notification_setting`;--> statement-breakpoint
ALTER TABLE `__new_notification_setting` RENAME TO `notification_setting`;--> statement-breakpoint
PRAGMA foreign_keys=ON;