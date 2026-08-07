-- What has been going on, for the feed to show (#303).
--
-- The same events the burn-wide notifications carry, written once for everybody rather
-- than once per person — `schema.ts` says why, and why the CHECK lists the notification
-- vocabulary. Cascades with the burn, which is the whole of the retention rule.
CREATE TABLE `activity` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text NOT NULL,
	CONSTRAINT `activity_pk` PRIMARY KEY(`id`),
	CONSTRAINT `activity_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT "activity_category_check" CHECK("category" in ('meal_role', 'dream_role', 'lead_role', 'payment', 'waiting_list_near', 'waiting_list_pushed', 'dream_offered', 'member_joined', 'lead_role_added', 'lead_role_filled', 'new_version', 'application'))
);
--> statement-breakpoint
CREATE INDEX `activity_recent_idx` ON `activity` (`created_at`);
