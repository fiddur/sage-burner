-- A note on a pantry thing (#819): what a cook should know while typing an amount — that the
-- kg on the row is dry weight, what a jar holds, how 0.09 kg becomes 2.5 dl. `docs/food.md`
-- says why this is a sentence rather than a second unit.
--
-- `ALTER TABLE … ADD COLUMN` with a constant default, which SQLite records in the schema
-- without rewriting a row. Not null with `''` rather than nullable: absent and empty are the
-- same answer here, and one of them is a case the reader would have to handle.
ALTER TABLE `pantry_item` ADD COLUMN `note` text DEFAULT '' NOT NULL;
