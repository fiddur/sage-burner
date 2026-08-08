DROP INDEX `ride_event_idx`;--> statement-breakpoint
CREATE INDEX `ride_event_idx` ON `ride` (`event_id`,`created_at`);
