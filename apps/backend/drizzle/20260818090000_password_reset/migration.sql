-- A forgotten password can be reset by email (#738). `docs/accounts.md` has the why; what the
-- table's shape says is that a live reset is a row and nothing else: the token itself is never
-- stored, `token_hash` being the primary key makes a spent link unfindable once the row is
-- deleted, and the cascade takes a deleted account's reset with it.
CREATE TABLE `password_reset` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_password_reset_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
