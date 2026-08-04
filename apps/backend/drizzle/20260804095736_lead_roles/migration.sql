CREATE TABLE `lead_role` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`purpose` text NOT NULL,
	`tasks` text NOT NULL,
	`effort_before` text NOT NULL,
	`effort_during` text NOT NULL,
	`effort_after` text NOT NULL,
	`team_size_wanted` integer NOT NULL,
	`lead_attendance_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_lead_role_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_lead_role_lead_attendance_id_attendance_id_fk` FOREIGN KEY (`lead_attendance_id`) REFERENCES `attendance`(`id`) ON DELETE SET NULL,
	CONSTRAINT "lead_role_title_check" CHECK(length(trim("title")) > 0),
	CONSTRAINT "lead_role_team_size_check" CHECK("team_size_wanted" >= 0),
	CONSTRAINT "lead_role_effort_before_check" CHECK("effort_before" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "lead_role_effort_during_check" CHECK("effort_during" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "lead_role_effort_after_check" CHECK("effort_after" in ('none', 'low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE `lead_role_member` (
	`role_id` text NOT NULL,
	`attendance_id` text NOT NULL,
	CONSTRAINT `lead_role_member_pk` PRIMARY KEY(`role_id`, `attendance_id`),
	CONSTRAINT `fk_lead_role_member_role_id_lead_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `lead_role`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_lead_role_member_attendance_id_attendance_id_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `lead_role_event_idx` ON `lead_role` (`event_id`);