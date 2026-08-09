-- Who somebody is, in their own words and pictures (#390).
--
-- An `ALTER TABLE … ADD COLUMN` rather than a rebuild: the column is new and nullable, so
-- SQLite adds it in place. Null rather than empty for an account that has not written one —
-- the page has different things to say to somebody with nothing written yet and to somebody
-- who cleared it, and only null tells them apart.
--
-- A column rather than a table: one field with one owner. `schema.ts` has the rest.
ALTER TABLE `account` ADD `introduction` text;
