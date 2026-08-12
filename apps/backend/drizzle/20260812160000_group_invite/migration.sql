-- A link posted inside a closed group is readable only by its members, so the link itself
-- carries the vetting (#512). That kind is redeemable until it expires rather than once, which
-- is the opposite of every invite before it — hence `kind`.
--
-- No table-level CHECK comes with it, deliberately: SQLite cannot add one through ALTER TABLE,
-- and rebuilding `invite_token` would mean dropping and recreating a table two others hold
-- foreign keys into. The shape rules — a single-use token carries no cap and no revocation, a
-- group one no application and no `used_at` — are enforced where the rows are written, and the
-- route tests are what hold them.
ALTER TABLE `invite_token` ADD COLUMN `kind` text NOT NULL DEFAULT 'single';--> statement-breakpoint
ALTER TABLE `invite_token` ADD COLUMN `label` text;--> statement-breakpoint
ALTER TABLE `invite_token` ADD COLUMN `max_uses` integer;--> statement-breakpoint
ALTER TABLE `invite_token` ADD COLUMN `revoked_at` text;--> statement-breakpoint

-- One account per single-use token stays enforced by `account_invite_token_idx` on
-- `account.invite_token_id`, which is exactly the invariant a group link must not have. A group
-- redemption therefore leaves that column null and records itself here instead: one link, many
-- accounts, and a list an admin can audit. `account_id` is unique across the table, so nobody
-- arrives on two links whichever kind they came in on.
CREATE TABLE `invite_redemption` (
	`id` text NOT NULL,
	`token_id` text NOT NULL,
	`account_id` text NOT NULL,
	`redeemed_at` text NOT NULL,
	CONSTRAINT `invite_redemption_pk` PRIMARY KEY(`id`),
	CONSTRAINT `fk_invite_redemption_token_id_invite_token_id_fk` FOREIGN KEY (`token_id`) REFERENCES `invite_token`(`id`),
	CONSTRAINT `fk_invite_redemption_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_redemption_account_idx` ON `invite_redemption` (`account_id`);--> statement-breakpoint
CREATE INDEX `invite_redemption_token_idx` ON `invite_redemption` (`token_id`);
