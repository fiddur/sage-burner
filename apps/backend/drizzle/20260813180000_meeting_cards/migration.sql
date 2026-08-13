-- A meeting put in the diary before it had one (#616). Between #592 and #603 scheduling a meeting
-- wrote an `activity` line and no thread; #603 gave new meetings a card and backfilled nothing, and
-- #608 then swept those lines — so a meeting from that half-day is on the feed nowhere, with no
-- entry saying who planned it and when, and nowhere to reply that the time does not work.
--
-- One card per meeting that has none, dated from `meeting.created_at` rather than from the deploy,
-- so the feed orders it by when it was planned rather than by when it is. `20260811180000_joined_cards`
-- is the same shape, and `randomblob` is the id for the same reason: `thread.id` reaches the wire as
-- `z.uuid()`.
INSERT INTO `thread` (`id`, `event_id`, `entity_type`, `entity_id`, `subject_account_id`, `title`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
    || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-'
    || hex(randomblob(6))
  ),
  `diary`.`event_id`,
  'meeting',
  `diary`.`id`,
  NULL,
  `diary`.`title`
FROM `meeting` `diary`
WHERE NOT EXISTS (
  SELECT 1 FROM `thread` `card`
  WHERE `card`.`entity_type` = 'meeting' AND `card`.`entity_id` = `diary`.`id`
);--> statement-breakpoint
-- The planning itself, which is what `noteOnMeeting` writes on the ordinary path. Only where the
-- card has nothing in it at all, so a conversation is never given a second beginning. The author is
-- the meeting's, which is null for every row written before #603 added the column — those read
-- "Somebody put it in the diary", as a null author does everywhere else.
INSERT INTO `thread_entry` (`id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
    || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-'
    || hex(randomblob(6))
  ),
  `card`.`id`,
  'scheduled',
  1,
  `diary`.`author_account_id`,
  'put it in the diary',
  `diary`.`created_at`
FROM `meeting` `diary`
JOIN `thread` `card` ON `card`.`entity_type` = 'meeting' AND `card`.`entity_id` = `diary`.`id`
WHERE NOT EXISTS (SELECT 1 FROM `thread_entry` `line` WHERE `line`.`thread_id` = `card`.`id`);
