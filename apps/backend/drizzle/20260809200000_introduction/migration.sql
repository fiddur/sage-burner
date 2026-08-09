-- Who somebody is, in their own words and pictures (#390). Why a column rather than a table,
-- and why null rather than empty: "The introduction" in `docs/accounts.md`.
--
-- An `ALTER TABLE … ADD COLUMN` rather than a rebuild: the column is new and nullable, so
-- SQLite adds it in place.
ALTER TABLE `account` ADD `introduction` text;
