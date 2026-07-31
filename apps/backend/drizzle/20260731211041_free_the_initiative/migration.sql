PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attendance` (
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
	CONSTRAINT "attendance_payment_status_check" CHECK("payment_status" in ('unpaid', 'paid'))
);
--> statement-breakpoint
INSERT INTO `__new_attendance`(`id`, `event_id`, `account_id`, `joined_at`, `arrival_date`, `departure_date`, `lodging`, `shift_preference`, `notes`, `payment_status`, `payment_date`) SELECT `id`, `event_id`, `account_id`, `joined_at`, `arrival_date`, `departure_date`, `lodging`, `shift_preference`, `notes`, `payment_status`, `payment_date` FROM `attendance`;--> statement-breakpoint
DROP TABLE `attendance`;--> statement-breakpoint
ALTER TABLE `__new_attendance` RENAME TO `attendance`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_event_account_idx` ON `attendance` (`event_id`,`account_id`);