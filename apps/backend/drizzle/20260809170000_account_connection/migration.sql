-- The ways somebody has said they can be reached (#388), which the app previously knew
-- only as `account.contact` — one free-text box that produced "fredrik on discord i
-- think" and an organiser guessing (#88).
--
-- Rows rather than a column per network: the list is ordered and the order is half the
-- point, since the first one is where somebody is actually reached. A column per network
-- would also be a migration every time one is added, where this is a line in `enums.ts`.
--
-- `contact` stays exactly as it is. It is required by the details page, drawn on the
-- roster and on the rideshare board, and merging it into this list touches all three —
-- its own change, not this one.
CREATE TABLE `account_connection` (
	`id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`order` integer NOT NULL,
	CONSTRAINT `account_connection_pk` PRIMARY KEY(`id`),
	CONSTRAINT `account_connection_account_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT "account_connection_kind_check" CHECK("kind" in ('email', 'phone', 'signal', 'whatsapp', 'discord', 'instagram', 'tiktok', 'mastodon', 'link')),
	CONSTRAINT "account_connection_value_check" CHECK(length(trim("value")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_connection_unique_idx` ON `account_connection` (`account_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `account_connection_account_idx` ON `account_connection` (`account_id`,`order`);
