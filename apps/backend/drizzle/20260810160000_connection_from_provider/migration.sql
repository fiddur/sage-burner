-- Nullable, so an in-place add rather than the table rebuild `runMigrations` disarms foreign
-- keys for. No CHECK on the vocabulary: adding one to an existing table means that rebuild.
ALTER TABLE `account_connection` ADD `from_provider` text;
