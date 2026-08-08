-- Getting to the burn and back (#26), which the spreadsheet kept as a Rideshares tab.
-- `docs/burns.md` has the shape; the CHECK on `kind` is the two halves of the board.
-- No contact column: it lives on the account, and cascades take a journey with either
-- the burn or the person.
CREATE TABLE `ride` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`from` text NOT NULL,
	`when` text NOT NULL,
	`seats` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `ride_pk` PRIMARY KEY(`id`),
	CONSTRAINT `ride_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT `ride_account_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT "ride_kind_check" CHECK("kind" in ('needs', 'offers')),
	CONSTRAINT "ride_from_check" CHECK(length(trim("from")) > 0),
	CONSTRAINT "ride_when_check" CHECK(length(trim("when")) > 0),
	CONSTRAINT "ride_seats_check" CHECK("seats" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ride_event_idx` ON `ride` (`event_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `ride_account_idx` ON `ride` (`account_id`);
