-- Talking to an applicant (#477), so a question can replace a rejection. Not the feed's threads:
-- those are member-visible by design, and this is the one conversation that must not be.
CREATE TABLE `application_message` (
	`id` text NOT NULL,
	`application_id` text NOT NULL,
	`author_account_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `application_message_pk` PRIMARY KEY(`id`),
	CONSTRAINT `fk_application_message_application_id_application_id_fk` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_application_message_author_account_id_account_id_fk` FOREIGN KEY (`author_account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `application_message_idx` ON `application_message` (`application_id`,`created_at`);
