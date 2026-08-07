-- Notifications about what is going on, not only about you (#259).
--
-- Five new categories — a dream offered, somebody saying they are coming, a lead role
-- added, a lead taken, a redeploy — and all five are **off** unless somebody asks for
-- them. A burn where every arrival pings forty-two people is a channel people learn
-- to ignore, which costs the notifications that are actually about them.
--
-- That default is what forces the second table below to change shape. `notification_mute`
-- held only the categories somebody had switched *off*, and absence meant on. One list
-- of exceptions cannot mean "off" for six categories and "on" for five without every
-- reader having to know which is which. So a row now carries `enabled` and means
-- "this person said"; absence means they have not, and the default lives in
-- `notificationCategoryInfo`. Nothing is seeded, so an account made tomorrow still
-- picks up today's defaults without a migration teaching it to.
--
-- Both tables are rebuilt rather than altered because both carry a CHECK listing the
-- vocabulary, and SQLite cannot alter one in place.
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
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'member_joined', 'lead_role_added', 'lead_role_filled', 'new_version'))
);
--> statement-breakpoint
INSERT INTO `__new_notification` (`id`, `account_id`, `category`, `body`, `link`, `created_at`, `seen_at`)
SELECT `id`, `account_id`, `category`, `body`, `link`, `created_at`, `seen_at` FROM `notification`;
--> statement-breakpoint
DROP TABLE `notification`;--> statement-breakpoint
ALTER TABLE `__new_notification` RENAME TO `notification`;--> statement-breakpoint
CREATE INDEX `notification_account_idx` ON `notification` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_setting` (
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`enabled` integer NOT NULL,
	CONSTRAINT `notification_setting_pk` PRIMARY KEY(`account_id`, `category`),
	CONSTRAINT `fk_notification_setting_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_setting_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'member_joined', 'lead_role_added', 'lead_role_filled', 'new_version'))
);
--> statement-breakpoint
-- Every existing mute was somebody saying "not this one", so it carries over as an
-- explicit off. Nothing becomes an explicit on: an account that never touched the
-- settings has still not said anything, and writing rows for it here would freeze
-- today's defaults into the database.
INSERT INTO `notification_setting` (`account_id`, `category`, `enabled`)
SELECT `account_id`, `category`, 0 FROM `notification_mute`;
--> statement-breakpoint
DROP TABLE `notification_mute`;--> statement-breakpoint
-- What the last boot was running, so the next one can tell a redeploy from a restart.
-- Null until the first boot that looks, which records without announcing.
ALTER TABLE `installation` ADD `last_build_sha` text;
