-- One card per role that has none, which on the way in is every role there is. Without it a role
-- added before today has nowhere to be talked about until somebody happens to change its lead,
-- and the register the feed now links to would be the only place it exists.
-- `20260813180000_meeting_cards` is the same shape, and `randomblob` is the id for the same
-- reason: `thread.id` reaches the wire as `z.uuid()`.
INSERT INTO `thread` (`id`, `event_id`, `entity_type`, `entity_id`, `subject_account_id`, `title`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
    || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-'
    || hex(randomblob(6))
  ),
  `job`.`event_id`,
  'role',
  `job`.`id`,
  NULL,
  `job`.`title`
FROM `lead_role` `job`
WHERE NOT EXISTS (
  SELECT 1 FROM `thread` `card`
  WHERE `card`.`entity_type` = 'role' AND `card`.`entity_id` = `job`.`id`
);--> statement-breakpoint
-- The adding itself, dated from `lead_role.created_at` so the feed orders the card by when the
-- role appeared rather than by when this ran. The author is null — nothing recorded who added a
-- role until now — so these read "Somebody added this lead role", as a null author does everywhere.
-- Who holds the role is not invented: that is on the register, and the date it was taken on is
-- gone with the lines `20260815100000_role_threads` drops.
INSERT INTO `thread_entry` (`id`, `thread_id`, `kind`, `seq`, `author_account_id`, `body`, `created_at`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
    || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-'
    || hex(randomblob(6))
  ),
  `card`.`id`,
  'added',
  1,
  NULL,
  'added this lead role',
  `job`.`created_at`
FROM `lead_role` `job`
JOIN `thread` `card` ON `card`.`entity_type` = 'role' AND `card`.`entity_id` = `job`.`id`
WHERE NOT EXISTS (
  SELECT 1 FROM `thread_entry` `said` WHERE `said`.`thread_id` = `card`.`id`
);
