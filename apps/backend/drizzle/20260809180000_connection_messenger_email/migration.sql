-- Messenger as a way to connect, and the address everybody already has, in the list.
--
-- Two changes that have to be one migration: the vocabulary gains `messenger`, which is a
-- CHECK rebuild, and the backfill below has to land in the rebuilt table rather than the
-- one being dropped.
--
-- `kind`'s CHECK lists the vocabulary and SQLite cannot alter a CHECK in place, so the
-- table is rebuilt — the same shape `20260806180000_general_notifications` needed when the
-- notification categories grew. This is the cost `enums.ts` and `docs/accounts.md` now warn
-- about: a kind added to the vocabulary alone passes Zod and the type checker and then
-- fails here.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_connection` (
	`id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`order` integer NOT NULL,
	CONSTRAINT `account_connection_pk` PRIMARY KEY(`id`),
	CONSTRAINT `account_connection_account_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT "account_connection_kind_check" CHECK("kind" in ('email', 'phone', 'signal', 'whatsapp', 'messenger', 'discord', 'instagram', 'tiktok', 'mastodon', 'link')),
	CONSTRAINT "account_connection_value_check" CHECK(length(trim("value")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_account_connection` (`id`, `account_id`, `kind`, `value`, `label`, `order`)
SELECT `id`, `account_id`, `kind`, `value`, `label`, `order` FROM `account_connection`;
--> statement-breakpoint
DROP TABLE `account_connection`;--> statement-breakpoint
ALTER TABLE `__new_account_connection` RENAME TO `account_connection`;--> statement-breakpoint
CREATE UNIQUE INDEX `account_connection_unique_idx` ON `account_connection` (`account_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `account_connection_account_idx` ON `account_connection` (`account_id`,`order`);--> statement-breakpoint
-- Every account gets its login address as a way to be reached, because it already has one
-- and a list that starts empty is a list nobody fills in. It is an ordinary row from here:
-- sortable, editable, and removable by the person whose it is — present by default is not
-- the same as imposed.
--
-- **Last rather than first.** Somebody who has already put Discord at the top chose that,
-- and inserting above it would silently override the one thing the order is for. An account
-- with no rows gets 0 either way.
--
-- Skipped where an `email` row already exists, whatever address it holds: "already present"
-- is satisfied by any of them, and a second would collide with
-- `account_connection_unique_idx` only when the addresses matched.
--
-- This publishes the login address to members, which the list's own note says it does. It
-- is no new exposure: `redemption.ts` has always copied that address into `account.contact`,
-- and `contact` is on the roster every approved member reads.
INSERT INTO `account_connection` (`id`, `account_id`, `kind`, `value`, `label`, `order`)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
	),
	`account`.`id`,
	'email',
	`account`.`email`,
	'',
	coalesce(
		(SELECT max(`held`.`order`) + 1 FROM `account_connection` AS `held` WHERE `held`.`account_id` = `account`.`id`),
		0
	)
FROM `account`
WHERE NOT EXISTS (
	SELECT 1 FROM `account_connection` AS `mine`
	WHERE `mine`.`account_id` = `account`.`id` AND `mine`.`kind` = 'email'
);
