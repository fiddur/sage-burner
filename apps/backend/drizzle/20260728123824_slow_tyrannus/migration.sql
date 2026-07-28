CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL UNIQUE,
	`password_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_role` (
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT `account_role_pk` PRIMARY KEY(`account_id`, `role`),
	CONSTRAINT `fk_account_role_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "account_role_check" CHECK("role" in ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE `application` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`answers` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applicant_name` text NOT NULL,
	`applicant_contact` text NOT NULL,
	`submitted_at` text NOT NULL,
	`decided_at` text,
	CONSTRAINT `fk_application_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT "application_status_check" CHECK("status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`welcome_markdown` text DEFAULT '' NOT NULL,
	`member_cap` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `form_question` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`order` integer NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`help_text` text,
	`required` integer DEFAULT false NOT NULL,
	`options` text,
	CONSTRAINT `fk_form_question_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT "form_question_type_check" CHECK("type" in ('text', 'textarea', 'checkbox', 'agreement'))
);
--> statement-breakpoint
CREATE TABLE `invite_token` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`event_id` text NOT NULL,
	`application_id` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_by` text NOT NULL,
	CONSTRAINT `fk_invite_token_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invite_token_application_id_application_id_fk` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_invite_token_created_by_account_id_fk` FOREIGN KEY (`created_by`) REFERENCES `account`(`id`)
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`contact` text NOT NULL,
	`allergies_notes` text,
	`arrival_date` text,
	`departure_date` text,
	`lodging` text,
	`shift_preference` text,
	`notes` text,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`payment_date` text,
	`invite_token_id` text NOT NULL,
	CONSTRAINT `fk_member_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`),
	CONSTRAINT `fk_member_invite_token_id_invite_token_id_fk` FOREIGN KEY (`invite_token_id`) REFERENCES `invite_token`(`id`),
	CONSTRAINT "member_payment_status_check" CHECK("payment_status" in ('unpaid', 'partial', 'paid'))
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`credential_id` text NOT NULL UNIQUE,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_passkey_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`host_member_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`time_slot_start` text,
	`time_slot_end` text,
	`location` text,
	CONSTRAINT `fk_session_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_host_member_id_member_id_fk` FOREIGN KEY (`host_member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `application_event_status_idx` ON `application` (`event_id`,`status`);--> statement-breakpoint
CREATE INDEX `form_question_event_order_idx` ON `form_question` (`event_id`,`order`);--> statement-breakpoint
CREATE INDEX `invite_token_event_idx` ON `invite_token` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_event_account_idx` ON `member` (`event_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `member_event_idx` ON `member` (`event_id`);--> statement-breakpoint
CREATE INDEX `passkey_account_idx` ON `passkey` (`account_id`);--> statement-breakpoint
CREATE INDEX `session_event_slot_idx` ON `session` (`event_id`,`time_slot_start`);