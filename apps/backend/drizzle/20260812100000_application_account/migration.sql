-- The account comes first and the application second (#476), so an application is somebody's
-- rather than a form somebody posted. Nullable, because the applications submitted before this
-- have no account to point at — the invite they were approved with is what carries them.
--
-- Unique rather than a plain index: one application per account is the rule the status page reads
-- by, and the database is a better place to hold it than the one route that writes it.
ALTER TABLE `application` ADD COLUMN `account_id` text REFERENCES `account`(`id`) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `application_account_idx` ON `application` (`account_id`);
