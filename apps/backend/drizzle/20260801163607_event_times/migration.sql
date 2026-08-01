ALTER TABLE `event` ADD `start_time` text DEFAULT '00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `end_time` text DEFAULT '23:59' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_time` text DEFAULT '00:00' NOT NULL,
	`end_time` text DEFAULT '23:59' NOT NULL,
	`welcome_markdown` text DEFAULT '' NOT NULL,
	`member_cap` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "event_start_date_check" CHECK("start_date" is null or "start_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "event_end_date_check" CHECK("end_date" is null or "end_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "event_date_order_check" CHECK("end_date" > "start_date" or ("end_date" = "start_date" and "end_time" >= "start_time")),
	CONSTRAINT "event_start_time_check" CHECK("start_time" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("start_time", 1, 2) as integer) < 24),
	CONSTRAINT "event_end_time_check" CHECK("end_time" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("end_time", 1, 2) as integer) < 24),
	CONSTRAINT "event_member_cap_check" CHECK("member_cap" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_event`(`id`, `name`, `slug`, `start_date`, `end_date`, `welcome_markdown`, `member_cap`, `created_at`) SELECT `id`, `name`, `slug`, `start_date`, `end_date`, `welcome_markdown`, `member_cap`, `created_at` FROM `event`;--> statement-breakpoint
DROP TABLE `event`;--> statement-breakpoint
ALTER TABLE `__new_event` RENAME TO `event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;