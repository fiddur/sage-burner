-- Following one card, and muting one (#480). Absence means the default — what the participants
-- logic already decides — so a row is only ever written by somebody saying otherwise.
CREATE TABLE `thread_follow` (
	`thread_id` text NOT NULL,
	`account_id` text NOT NULL,
	`enabled` integer NOT NULL,
	CONSTRAINT `thread_follow_pk` PRIMARY KEY(`thread_id`, `account_id`),
	CONSTRAINT `fk_thread_follow_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_follow_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
