-- The calendar feed gets an address of its own (#408). Why not the burn's id, and why this
-- is rotatable: "The calendar feed" in `docs/burns.md`.
--
-- Nullable, so no rebuild: SQLite adds a column with a constant default in place, and a
-- per-row random value is not a constant. Backfilled below instead, and `createEvent` mints
-- one from `randomBytes` — this uses SQLite's own PRNG because it is the only thing that can
-- write a different value per row from inside a migration.
ALTER TABLE `event` ADD `feed_token` text;--> statement-breakpoint
UPDATE `event` SET `feed_token` = lower(hex(randomblob(32))) WHERE `feed_token` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `event_feed_token_idx` ON `event` (`feed_token`) WHERE `feed_token` is not null;
