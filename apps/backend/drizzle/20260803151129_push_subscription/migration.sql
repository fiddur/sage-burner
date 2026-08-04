CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_push_subscription_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `installation` ADD `vapid_public_key` text;--> statement-breakpoint
ALTER TABLE `installation` ADD `vapid_private_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_endpoint_idx` ON `push_subscription` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscription_account_idx` ON `push_subscription` (`account_id`);