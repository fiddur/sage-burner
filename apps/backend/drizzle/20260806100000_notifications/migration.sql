-- Notifications as records, with push as one channel for them (#248).
--
-- The bell needs history — what happened while you were away, and whether you have
-- looked — and a push message is gone the moment it is dismissed. So the row is the
-- notification and the push is a copy of it.
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	-- Where clicking it goes. Null for anything with no page of its own.
	`link` text,
	`created_at` text NOT NULL,
	-- Null until the bell has been opened. What makes it go grey again.
	`seen_at` text,
	CONSTRAINT `fk_notification_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed'))
);--> statement-breakpoint
CREATE INDEX `notification_account_idx` ON `notification` (`account_id`,`created_at`);--> statement-breakpoint
-- Only what somebody has switched *off*, so "default all ticked" needs no seeding —
-- and an account created tomorrow gets the same defaults without a migration.
CREATE TABLE `notification_mute` (
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	CONSTRAINT `notification_mute_pk` PRIMARY KEY(`account_id`, `category`),
	CONSTRAINT `fk_notification_mute_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_mute_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed'))
);
