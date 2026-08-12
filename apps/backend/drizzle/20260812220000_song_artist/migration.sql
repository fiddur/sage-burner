-- Whose song it is (#538), as a field of its own rather than a line in the words: a songbook is
-- browsed by who wrote it as often as by what it is called, and a name buried in the body cannot
-- be sorted on.
--
-- Nullable, because most of what is already in the book has no artist recorded and a blank is not
-- an artist called "". `nonEmptyText(...).nullable()` in `packages/shared` is what refuses the
-- empty string, and there is no CHECK here to say the same thing: SQLite cannot add one through
-- ALTER TABLE, and rebuilding `song` would take `song_in_category` down with it.
ALTER TABLE `song` ADD COLUMN `artist` text;
