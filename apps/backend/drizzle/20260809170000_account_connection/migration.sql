-- The ways somebody has said they can be reached (#388), which the app previously knew
-- only as `account.contact` — one free-text box that produced "fredrik on discord i
-- think" and an organiser guessing (#88). Why rows rather than a column per network, and
-- why `contact` is left alone: "The ways somebody can be reached" in `docs/accounts.md`.
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
