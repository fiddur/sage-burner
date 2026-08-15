-- A heart on a comment as well as on the card it is under (#693). The same shape as
-- `thread_support`, account-keyed for the same reason: a song's thread belongs to no burn,
-- so there is no attendance to hang one on.
CREATE TABLE `entry_support` (
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	CONSTRAINT `entry_support_pk` PRIMARY KEY(`entry_id`, `account_id`),
	CONSTRAINT `fk_entry_support_entry_id_thread_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `thread_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_entry_support_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
