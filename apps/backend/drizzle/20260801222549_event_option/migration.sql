CREATE TABLE `event_option` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`order` integer NOT NULL,
	`label` text NOT NULL,
	`capacity` integer,
	CONSTRAINT `fk_event_option_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT "event_option_kind_check" CHECK("kind" in ('lodging', 'helping')),
	CONSTRAINT "event_option_order_check" CHECK("order" >= 0),
	CONSTRAINT "event_option_label_check" CHECK(length(trim("label")) > 0),
	CONSTRAINT "event_option_capacity_check" CHECK("capacity" is null or "capacity" > 0)
);
--> statement-breakpoint
CREATE INDEX `event_option_event_kind_idx` ON `event_option` (`event_id`,`kind`,`order`);