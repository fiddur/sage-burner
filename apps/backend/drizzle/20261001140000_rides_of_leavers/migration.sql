-- Journeys whose poster is no longer coming to that burn, with their cards. Migrations run with
-- `foreign_keys = OFF`, so each child of `thread` is deleted by hand before it.
DELETE FROM `entry_support` WHERE `entry_id` IN (
	SELECT `thread_entry`.`id` FROM `thread_entry` JOIN `thread` ON `thread`.`id` = `thread_entry`.`thread_id`
	WHERE `thread`.`entity_type` = 'ride' AND `thread`.`entity_id` IN (
		SELECT `id` FROM `ride` WHERE NOT EXISTS (
			SELECT 1 FROM `attendance`
			WHERE `attendance`.`event_id` = `ride`.`event_id` AND `attendance`.`account_id` = `ride`.`account_id`
		)
	)
);--> statement-breakpoint
DELETE FROM `thread_entry` WHERE `thread_id` IN (
	SELECT `id` FROM `thread` WHERE `entity_type` = 'ride' AND `entity_id` IN (
		SELECT `id` FROM `ride` WHERE NOT EXISTS (
			SELECT 1 FROM `attendance`
			WHERE `attendance`.`event_id` = `ride`.`event_id` AND `attendance`.`account_id` = `ride`.`account_id`
		)
	)
);--> statement-breakpoint
DELETE FROM `thread_support` WHERE `thread_id` IN (
	SELECT `id` FROM `thread` WHERE `entity_type` = 'ride' AND `entity_id` IN (
		SELECT `id` FROM `ride` WHERE NOT EXISTS (
			SELECT 1 FROM `attendance`
			WHERE `attendance`.`event_id` = `ride`.`event_id` AND `attendance`.`account_id` = `ride`.`account_id`
		)
	)
);--> statement-breakpoint
DELETE FROM `thread_follow` WHERE `thread_id` IN (
	SELECT `id` FROM `thread` WHERE `entity_type` = 'ride' AND `entity_id` IN (
		SELECT `id` FROM `ride` WHERE NOT EXISTS (
			SELECT 1 FROM `attendance`
			WHERE `attendance`.`event_id` = `ride`.`event_id` AND `attendance`.`account_id` = `ride`.`account_id`
		)
	)
);--> statement-breakpoint
DELETE FROM `thread` WHERE `entity_type` = 'ride' AND `entity_id` IN (
	SELECT `id` FROM `ride` WHERE NOT EXISTS (
		SELECT 1 FROM `attendance`
		WHERE `attendance`.`event_id` = `ride`.`event_id` AND `attendance`.`account_id` = `ride`.`account_id`
	)
);--> statement-breakpoint
DELETE FROM `ride` WHERE NOT EXISTS (
	SELECT 1 FROM `attendance`
	WHERE `attendance`.`event_id` = `ride`.`event_id` AND `attendance`.`account_id` = `ride`.`account_id`
);
