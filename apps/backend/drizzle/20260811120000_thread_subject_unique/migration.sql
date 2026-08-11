-- #463's backfill read `attendance` by `entity_id`, so a card for somebody who had already
-- left before it ran found no row and kept `subject_account_id` NULL — the frozen title, no
-- link, and a rejoin opening a second card beside it. The person is still recoverable from
-- whoever wrote the card's first entry, which on an attendance card is the arrival itself.
UPDATE `thread`
SET `subject_account_id` = (
  SELECT `author_account_id` FROM `thread_entry`
  WHERE `thread_entry`.`thread_id` = `thread`.`id` AND `thread_entry`.`author_account_id` IS NOT NULL
  ORDER BY `thread_entry`.`seq`
  LIMIT 1
)
WHERE `entity_type` = 'attendance' AND `subject_account_id` IS NULL;--> statement-breakpoint
-- Somebody who left and rejoined before #463 now has two cards for one burn, and the unique
-- index below is what stops that recurring. The one whose stay still exists keeps the pair;
-- where neither stay exists either card is as good, so the tie is broken by id to keep the
-- choice the same for every entry being moved.
UPDATE `thread_entry`
SET `thread_id` = (
  SELECT `keeper`.`id` FROM `thread` `keeper`, `thread` `held`
  WHERE `held`.`id` = `thread_entry`.`thread_id`
    AND `keeper`.`entity_type` = 'attendance'
    AND `keeper`.`subject_account_id` = `held`.`subject_account_id`
    AND `keeper`.`event_id` = `held`.`event_id`
  ORDER BY `keeper`.`entity_id` IN (SELECT `id` FROM `attendance`) DESC, `keeper`.`id` DESC
  LIMIT 1
)
WHERE `thread_id` IN (
  SELECT `held`.`id` FROM `thread` `held`
  WHERE `held`.`entity_type` = 'attendance'
    AND `held`.`subject_account_id` IS NOT NULL
    AND `held`.`id` <> (
      SELECT `keeper`.`id` FROM `thread` `keeper`
      WHERE `keeper`.`entity_type` = 'attendance'
        AND `keeper`.`subject_account_id` = `held`.`subject_account_id`
        AND `keeper`.`event_id` = `held`.`event_id`
      ORDER BY `keeper`.`entity_id` IN (SELECT `id` FROM `attendance`) DESC, `keeper`.`id` DESC
      LIMIT 1
    )
);--> statement-breakpoint
-- Two threads' `seq` numbering now runs 1, 2, 1, 2 in one thread, and `readThreads` orders by
-- it. Numbered by time instead, and only for the cards that took entries in — a `seq` order
-- elsewhere can disagree with `created_at`, since coalescing an entry moves its time forward.
WITH `merged` AS (
  SELECT
    `entry`.`id` AS `id`,
    row_number() OVER (PARTITION BY `entry`.`thread_id` ORDER BY `entry`.`created_at`, `entry`.`id`) AS `rank`
  FROM `thread_entry` `entry`
  WHERE `entry`.`thread_id` IN (
    SELECT `held`.`id` FROM `thread` `held`
    WHERE `held`.`entity_type` = 'attendance'
      AND `held`.`subject_account_id` IS NOT NULL
      AND (
        SELECT COUNT(*) FROM `thread` `other`
        WHERE `other`.`entity_type` = 'attendance'
          AND `other`.`subject_account_id` = `held`.`subject_account_id`
          AND `other`.`event_id` = `held`.`event_id`
      ) > 1
  )
)
UPDATE `thread_entry`
SET `seq` = (SELECT `rank` FROM `merged` WHERE `merged`.`id` = `thread_entry`.`id`)
WHERE `id` IN (SELECT `id` FROM `merged`);--> statement-breakpoint
DELETE FROM `thread`
WHERE `entity_type` = 'attendance'
  AND NOT EXISTS (SELECT 1 FROM `thread_entry` WHERE `thread_entry`.`thread_id` = `thread`.`id`)
  AND EXISTS (
    SELECT 1 FROM `thread` `other`
    WHERE `other`.`id` <> `thread`.`id`
      AND `other`.`entity_type` = 'attendance'
      AND `other`.`subject_account_id` = `thread`.`subject_account_id`
      AND `other`.`event_id` = `thread`.`event_id`
  );--> statement-breakpoint
-- A card is per person per burn, and `cardFor` was the only thing holding that: it reads with
-- `limit(1)` and no order, so a second row would have made it pick arbitrarily. NULLs stay
-- distinct in a SQLite unique index, so the cards no person could be recovered for above are
-- unaffected, as is every thread that is not somebody's.
DROP INDEX `thread_subject_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_subject_idx` ON `thread` (`subject_account_id`,`event_id`);
