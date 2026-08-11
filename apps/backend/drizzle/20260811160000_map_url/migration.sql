-- Where the gathering is, as a link out to whatever map whoever drew it already maintains (#315).
-- On `installation` rather than on `event`: one place, one link, and the burns are all at it.
ALTER TABLE `installation` ADD COLUMN `map_url` text;
