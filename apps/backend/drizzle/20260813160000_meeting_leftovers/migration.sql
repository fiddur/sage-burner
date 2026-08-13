-- What a meeting left behind on the feed (#608), in two shapes.
--
-- The lines: between #592 and #603 a scheduled meeting wrote an `activity` row, having no card to
-- be its presence on the feed. #603 gave it one and stopped writing them, but nothing deletes an
-- `activity` row except its burn going, so those rows are on the feed for ever — and stay after the
-- meeting itself is taken out of the diary. `meeting_scheduled` is the only category that
-- half-day's code ever wrote there, and nothing writes it there now.
DELETE FROM `activity` WHERE `category` = 'meeting_scheduled';--> statement-breakpoint
-- The orphans: `thread` is polymorphic, so deleting a meeting or a point never took its thread, and
-- the card went on rendering `gone` for a thing that no longer exists. The route deletes both
-- together from now on; these are the ones already stranded.
--
-- The children are deleted by hand rather than left to `ON DELETE cascade`, because `runMigrations`
-- brackets every migration in `PRAGMA foreign_keys = OFF` — so a cascade that is load-bearing at
-- runtime does nothing here, and `PRAGMA foreign_key_check` afterwards would find the danglers.
DELETE FROM `thread_entry` WHERE `thread_id` IN (
	SELECT `id` FROM `thread`
	WHERE (`entity_type` = 'meeting' AND `entity_id` NOT IN (SELECT `id` FROM `meeting`))
	   OR (`entity_type` = 'point' AND `entity_id` NOT IN (SELECT `id` FROM `meeting_point`))
);--> statement-breakpoint
DELETE FROM `thread_support` WHERE `thread_id` IN (
	SELECT `id` FROM `thread`
	WHERE (`entity_type` = 'meeting' AND `entity_id` NOT IN (SELECT `id` FROM `meeting`))
	   OR (`entity_type` = 'point' AND `entity_id` NOT IN (SELECT `id` FROM `meeting_point`))
);--> statement-breakpoint
DELETE FROM `thread_follow` WHERE `thread_id` IN (
	SELECT `id` FROM `thread`
	WHERE (`entity_type` = 'meeting' AND `entity_id` NOT IN (SELECT `id` FROM `meeting`))
	   OR (`entity_type` = 'point' AND `entity_id` NOT IN (SELECT `id` FROM `meeting_point`))
);--> statement-breakpoint
DELETE FROM `thread`
WHERE (`entity_type` = 'meeting' AND `entity_id` NOT IN (SELECT `id` FROM `meeting`))
   OR (`entity_type` = 'point' AND `entity_id` NOT IN (SELECT `id` FROM `meeting_point`));
