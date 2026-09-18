-- "Need more" on a pantry thing (#813): somebody standing in the cellar asking for a sack,
-- which is a different question from how much is on the shelf. `docs/food.md` has the why.
--
-- Two `ALTER TABLE … ADD COLUMN`s rather than a rebuild: both are nullable with no default, so
-- no existing row is rewritten and no cascade is armed. SQLite takes a `REFERENCES` clause in a
-- column it is adding as long as that column defaults to NULL, which these do.
--
-- No CHECK tying the two together. `need_more_by` goes null with the account while `need_more_at`
-- stays, exactly as `bought_by` / `bought_at` do on a purchase: the request outlives whoever made
-- it, and the importer writes one with no `by` at all. Flagged is `need_more_at is not null`.
ALTER TABLE `pantry_item` ADD COLUMN `need_more_by` text CONSTRAINT `pantry_item_need_more_by_fk` REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `pantry_item` ADD COLUMN `need_more_at` text;
