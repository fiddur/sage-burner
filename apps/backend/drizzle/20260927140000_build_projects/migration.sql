-- Build projects (#847), the eleventh thread entity type; `docs/burns.md` has the why.
CREATE TABLE `build_project` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`author_account_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tier` text NOT NULL,
	`order` integer NOT NULL,
	`lead_attendance_id` text,
	`withdrawn_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `build_project_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `build_project_author_fk` FOREIGN KEY (`author_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL,
	CONSTRAINT `build_project_lead_fk` FOREIGN KEY (`lead_attendance_id`) REFERENCES `attendance`(`id`) ON DELETE SET NULL,
	CONSTRAINT "build_project_title_check" CHECK(length(trim("title")) > 0),
	CONSTRAINT "build_project_tier_check" CHECK("tier" in ('reality', 'nice_to_have'))
);
--> statement-breakpoint
CREATE INDEX `build_project_event_idx` ON `build_project` (`event_id`,`tier`,`order`);--> statement-breakpoint
CREATE TABLE `build_helper` (
	`project_id` text NOT NULL,
	`attendance_id` text NOT NULL,
	CONSTRAINT `build_helper_pk` PRIMARY KEY(`project_id`, `attendance_id`),
	CONSTRAINT `build_helper_project_fk` FOREIGN KEY (`project_id`) REFERENCES `build_project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `build_helper_attendance_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `build_item` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`priority` text NOT NULL,
	`done_by_account_id` text,
	`done_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `build_item_project_fk` FOREIGN KEY (`project_id`) REFERENCES `build_project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `build_item_done_by_fk` FOREIGN KEY (`done_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL,
	CONSTRAINT "build_item_text_check" CHECK(length(trim("text")) > 0),
	CONSTRAINT "build_item_priority_check" CHECK("priority" in ('needed', 'good', 'bonus')),
	CONSTRAINT "build_item_done_check" CHECK("done_at" is not null or "done_by_account_id" is null)
);
--> statement-breakpoint
CREATE INDEX `build_item_project_idx` ON `build_item` (`project_id`);--> statement-breakpoint
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
	CONSTRAINT "thread_entity_type_check" CHECK("entity_type" in ('session', 'attendance', 'post', 'song', 'bring', 'point', 'meeting', 'role', 'meal', 'ride', 'build'))
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
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'ride_posted', 'ride_comment', 'ride_comment_any', 'build_added', 'build_role', 'build_comment', 'build_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'lead_role_comment', 'lead_role_comment_any', 'meal_taken', 'meal_comment', 'meal_comment_any', 'hearted', 'new_version', 'application', 'place_donated', 'application_news', 'payment_reminder'))
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
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'dream_comment', 'dream_comment_any', 'member_joined', 'introduction_written', 'introduction_comment', 'introduction_comment_any', 'post_written', 'post_comment', 'post_comment_any', 'song_added', 'song_comment', 'song_comment_any', 'bring_added', 'bring_answered', 'bring_role', 'bring_comment', 'bring_comment_any', 'ride_posted', 'ride_comment', 'ride_comment_any', 'build_added', 'build_role', 'build_comment', 'build_comment_any', 'point_raised', 'point_decided', 'point_comment', 'point_comment_any', 'meeting_scheduled', 'meeting_comment', 'meeting_comment_any', 'mentioned', 'lead_role_added', 'lead_role_filled', 'lead_role_comment', 'lead_role_comment_any', 'meal_taken', 'meal_comment', 'meal_comment_any', 'hearted', 'new_version', 'application', 'place_donated', 'application_news', 'payment_reminder'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_setting` (`account_id`, `category`, `enabled`, `email`)
SELECT `account_id`, `category`, `enabled`, `email` FROM `notification_setting`;
--> statement-breakpoint
DROP TABLE `notification_setting`;--> statement-breakpoint
ALTER TABLE `__new_notification_setting` RENAME TO `notification_setting`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
