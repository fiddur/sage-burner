PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invite_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`application_id` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_by` text NOT NULL,
	CONSTRAINT `fk_invite_token_application_id_application_id_fk` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_invite_token_created_by_account_id_fk` FOREIGN KEY (`created_by`) REFERENCES `account`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_invite_token`(`id`, `token_hash`, `application_id`, `expires_at`, `used_at`, `created_by`) SELECT `id`, `token_hash`, `application_id`, `expires_at`, `used_at`, `created_by` FROM `invite_token`;--> statement-breakpoint
DROP TABLE `invite_token`;--> statement-breakpoint
ALTER TABLE `__new_invite_token` RENAME TO `invite_token`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `invite_token_event_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_application_idx` ON `invite_token` (`application_id`) WHERE "invite_token"."application_id" is not null;