-- Passkeys, alongside passwords rather than instead of them (#9).
--
-- `passkey` has existed since the first migration and has never held a row: nothing
-- could write one until this issue added the ceremony routes. So the four new columns
-- arrive by rebuilding the table rather than as `ALTER TABLE ADD COLUMN`, which would
-- need `label` to carry a placeholder default forever to satisfy a NOT NULL on rows
-- that do not exist.
DROP TABLE `passkey`;--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`credential_id` text NOT NULL UNIQUE,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	CONSTRAINT `fk_passkey_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "passkey_counter_check" CHECK("counter" >= 0)
);--> statement-breakpoint
CREATE INDEX `passkey_account_idx` ON `passkey` (`account_id`);--> statement-breakpoint
-- One outstanding ceremony. A row rather than a signed cookie, because single-use is
-- the whole point of a challenge and only storage gives it.
--
-- `account_id` is null for a login, where nobody has said who they are yet.
CREATE TABLE `webauthn_challenge` (
	`challenge` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`expires_at` text NOT NULL,
	CONSTRAINT `fk_webauthn_challenge_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
