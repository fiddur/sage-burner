-- Something announced for its own sake, rather than a card mirroring another row (#438).
-- `author_account_id` is `set null` rather than a cascade: a burn's announcements outlive
-- somebody leaving, and the card then falls back to the thread's stored title.
CREATE TABLE `post` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`author_account_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`withdrawn_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `post_pk` PRIMARY KEY(`id`),
	CONSTRAINT `post_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT `post_author_fk` FOREIGN KEY (`author_account_id`) REFERENCES `account`(`id`) ON DELETE set null,
	CONSTRAINT "post_title_check" CHECK(length(trim("title")) > 0)
);
--> statement-breakpoint
CREATE INDEX `post_event_idx` ON `post` (`event_id`,`created_at`);
