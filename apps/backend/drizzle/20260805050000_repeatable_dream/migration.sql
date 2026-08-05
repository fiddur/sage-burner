-- A dream can be planned more than once (#198).
--
-- An `ALTER TABLE … ADD COLUMN` rather than a rebuild: the column is new, and
-- SQLite adds one with a constant default in place. Every existing dream is a
-- one-off, which is what `DEFAULT false` says.
ALTER TABLE `session` ADD `repeatable` integer DEFAULT false NOT NULL;
