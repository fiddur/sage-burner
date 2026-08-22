-- A dream folded into another keeps a pointer to where its conversation went, so the
-- trashcan can say so instead of offering a restore that would resurrect a husk.
-- "Folding one dream into another" in `docs/schedule.md` has the why.
ALTER TABLE `session` ADD `merged_into_id` text REFERENCES session(id);
