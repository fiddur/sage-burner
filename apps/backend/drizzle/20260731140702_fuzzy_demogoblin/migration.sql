CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`account_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`arrival_date` text,
	`departure_date` text,
	`lodging` text,
	`shift_preference` text,
	`notes` text,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`payment_date` text,
	CONSTRAINT `fk_attendance_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_attendance_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`),
	CONSTRAINT "attendance_arrival_date_check" CHECK("arrival_date" is null or "arrival_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "attendance_departure_date_check" CHECK("departure_date" is null or "departure_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "attendance_payment_date_check" CHECK("payment_date" is null or "payment_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "attendance_stay_order_check" CHECK("arrival_date" is null or "departure_date" is null
          or "departure_date" >= "arrival_date"),
	CONSTRAINT "attendance_payment_status_check" CHECK("payment_status" in ('unpaid', 'partial', 'paid'))
);
--> statement-breakpoint
ALTER TABLE `account` ADD `name` text;--> statement-breakpoint
ALTER TABLE `account` ADD `contact` text;--> statement-breakpoint
ALTER TABLE `account` ADD `allergies_notes` text;--> statement-breakpoint
ALTER TABLE `account` ADD `invite_token_id` text REFERENCES invite_token(id);--> statement-breakpoint
CREATE UNIQUE INDEX `account_invite_token_idx` ON `account` (`invite_token_id`) WHERE "account"."invite_token_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_event_account_idx` ON `attendance` (`event_id`,`account_id`);