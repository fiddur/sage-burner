-- A heart on every card (#479). Account-keyed rather than attendance-keyed, unlike
-- `session_support`: the songbook belongs to no burn, so there is no attendance to hang one on.
CREATE TABLE `thread_support` (
	`thread_id` text NOT NULL,
	`account_id` text NOT NULL,
	CONSTRAINT `thread_support_pk` PRIMARY KEY(`thread_id`, `account_id`),
	CONSTRAINT `fk_thread_support_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_support_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
