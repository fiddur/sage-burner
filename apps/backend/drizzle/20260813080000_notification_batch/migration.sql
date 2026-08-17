CREATE TABLE `notification_batch` (
	`id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	`told` integer DEFAULT 0 NOT NULL,
	`suppressed` integer DEFAULT 0 NOT NULL,
	`emailed` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`gone` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `notification_batch_pk` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `notification_batch_idx` ON `notification_batch` (`created_at`);
