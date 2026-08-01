CREATE TABLE `place` (
	`id` text PRIMARY KEY NOT NULL,
	`order` integer NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`color` text NOT NULL,
	CONSTRAINT "place_color_check" CHECK("color" in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'grey')),
	CONSTRAINT "place_order_check" CHECK("order" >= 0),
	CONSTRAINT "place_name_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "place_emoji_check" CHECK(length(trim("emoji")) > 0)
);
--> statement-breakpoint
CREATE INDEX `place_order_idx` ON `place` (`order`);