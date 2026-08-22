-- A withdrawn dream is stamped rather than deleted, so it can be brought back with its
-- comments, helpers and hearts. "Withdrawing a dream" in `docs/schedule.md` has the why.
ALTER TABLE `session` ADD `withdrawn_at` text;--> statement-breakpoint
-- Dreams deleted before this left their thread and comments orphaned; a session row shaped
-- like a withdrawal puts each back in the trashcan, title from the thread, details lost.
INSERT INTO `session` (`id`, `event_id`, `title`, `description`, `withdrawn_at`)
SELECT `t`.`entity_id`, `t`.`event_id`, `t`.`title`, '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `thread` `t`
WHERE `t`.`entity_type` = 'session'
  AND `t`.`event_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `session` `s` WHERE `s`.`id` = `t`.`entity_id`);
