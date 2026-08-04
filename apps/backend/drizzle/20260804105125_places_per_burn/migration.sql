-- Places become per event (#156).
--
-- Hand-written rather than generated: drizzle-kit emits
-- `ALTER TABLE place ADD event_id text NOT NULL REFERENCES event(id)`, and SQLite
-- refuses that outright — "Cannot add a NOT NULL column with default value NULL" —
-- with nowhere to put the backfill even if it did not. So this is the
-- create-copy-drop-rename shape, which is also what lets the foreign key carry
-- `on delete cascade`.
--
-- **Existing rows are assigned to the last created event**, ordered by
-- `created_at` — Fredrik's decision, and there is only one event today.
-- `created_at` rather than `start_date` because "last created" is what was asked
-- for, and it does not change meaning when somebody edits a burn's dates.
--
-- **If no event exists, the places are dropped.** The join selects nothing, and
-- that is the right answer rather than a loss: no event means no `session` rows
-- either, since they reference one, so the places are unreferenced decoration.
-- Worth saying out loud, because "the migration deleted my lanes" is otherwise a
-- surprise on a fresh install that happened to seed places.
--
-- With several events this rule could leave a `session` in burn A holding a place
-- now belonging to burn B, and the runner's `foreign_key_check` would not notice —
-- the place still exists. Nothing repairs that here, because the alternative is
-- nulling `place_id` and silently unscheduling dreams, which is the thing
-- `session.place_id`'s missing `onDelete` exists to prevent. It cannot arise on the
-- one database this runs against.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_place` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`order` integer NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`color` text NOT NULL,
	CONSTRAINT "place_color_check" CHECK("color" in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'grey')),
	CONSTRAINT "place_order_check" CHECK("order" >= 0),
	CONSTRAINT "place_name_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "place_emoji_check" CHECK(length(trim("emoji")) > 0),
	CONSTRAINT `fk_place_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_place` (`id`, `event_id`, `order`, `name`, `emoji`, `color`)
SELECT `place`.`id`, `last`.`id`, `place`.`order`, `place`.`name`, `place`.`emoji`, `place`.`color`
FROM `place`
JOIN (SELECT `id` FROM `event` ORDER BY `created_at` DESC, `id` DESC LIMIT 1) AS `last`;
--> statement-breakpoint
DROP TABLE `place`;--> statement-breakpoint
ALTER TABLE `__new_place` RENAME TO `place`;--> statement-breakpoint
CREATE INDEX `place_event_order_idx` ON `place` (`event_id`,`order`);
