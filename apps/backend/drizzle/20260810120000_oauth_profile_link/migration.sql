-- Somebody's Facebook page, from a linked sign-in (#405). Why asking for it is a setting
-- rather than always on, and why the URL lives on the identity rather than on the account:
-- "What linking gives you" in `docs/accounts.md`.
--
-- Both are in-place adds, so neither triggers the table rebuild `runMigrations` disables
-- foreign keys for: `ask_profile_link`'s default is a constant, which SQLite can fill in
-- without copying the table, and `profile_url` is nullable.
ALTER TABLE `oauth_setting` ADD `ask_profile_link` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `account_identity` ADD `profile_url` text;
