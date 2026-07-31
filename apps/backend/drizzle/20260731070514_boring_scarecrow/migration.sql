PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application` (
	`id` text PRIMARY KEY NOT NULL,
	`answers` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applicant_name` text NOT NULL,
	`applicant_contact` text NOT NULL,
	`submitted_at` text NOT NULL,
	`decided_at` text,
	CONSTRAINT "application_status_check" CHECK("status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_application`(`id`, `answers`, `status`, `applicant_name`, `applicant_contact`, `submitted_at`, `decided_at`) SELECT `id`, `answers`, `status`, `applicant_name`, `applicant_contact`, `submitted_at`, `decided_at` FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `application_event_status_idx`;--> statement-breakpoint
CREATE INDEX `application_status_idx` ON `application` (`status`);