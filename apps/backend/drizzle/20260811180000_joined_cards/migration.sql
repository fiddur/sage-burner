-- Redeeming an invite joined the burn without opening the card an ordinary join opens (#478), so
-- the members who arrived that way are missing from the feed entirely. One card per stay that has
-- none, dated from the stay itself rather than from the deploy, so the feed order stays honest.
--
-- `randomblob` is where the ids come from: `thread.id` reaches the wire as `idSchema`, which is
-- `z.uuid()`, so a readable made-up id would be a shape nothing else in the table has.
INSERT INTO `thread` (`id`, `event_id`, `entity_type`, `entity_id`, `subject_account_id`, `title`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
    || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-'
    || hex(randomblob(6))
  ),
  `stay`.`event_id`,
  'attendance',
  `stay`.`id`,
  `stay`.`account_id`,
  coalesce(`who`.`name`, 'Somebody')
FROM `attendance` `stay`
JOIN `account` `who` ON `who`.`id` = `stay`.`account_id`
WHERE NOT EXISTS (
  SELECT 1 FROM `thread` `card`
  WHERE `card`.`entity_type` = 'attendance'
    AND `card`.`subject_account_id` = `stay`.`account_id`
    AND `card`.`event_id` = `stay`.`event_id`
);--> statement-breakpoint
-- The arrival itself, which is what `cardEntry` writes on the ordinary path. Only where the card
-- has nothing in it at all, so an existing conversation is never given a second beginning.
INSERT INTO `thread_entry` (`id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
    || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-'
    || hex(randomblob(6))
  ),
  `card`.`id`,
  'joined',
  1,
  `stay`.`account_id`,
  'is coming',
  `stay`.`joined_at`
FROM `attendance` `stay`
JOIN `thread` `card`
  ON `card`.`entity_type` = 'attendance'
  AND `card`.`subject_account_id` = `stay`.`account_id`
  AND `card`.`event_id` = `stay`.`event_id`
WHERE NOT EXISTS (SELECT 1 FROM `thread_entry` `line` WHERE `line`.`thread_id` = `card`.`id`);
