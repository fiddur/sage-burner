-- A digest of what somebody has not seen (#620), for the people the app has otherwise lost.
--
-- `digest` is nullable because a stored value is an explicit choice and absence means "has not
-- said" — the rule `notification_setting` already follows. The default lives in `DEFAULT_DIGEST`
-- in the shared package, so an installation upgrading into this gets daily digests without a
-- backfill deciding anything on anybody's behalf.
--
-- `last_active_at` is "has been on the site", which no table held: a session is a signed cookie
-- with no row behind it. The auth hook writes it at most once an hour, which is why an hour is
-- also the finest window this can answer questions about.
--
-- `digest_sent_at` is both the anti-repeat guard — a digest never says again what the last one
-- said — and the double-send guard across the hours a nightly sweep is awake for.
ALTER TABLE `account` ADD COLUMN `digest` text CHECK (`digest` is null or `digest` in ('daily', 'weekly', 'off'));--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `last_active_at` text;--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `digest_sent_at` text;
