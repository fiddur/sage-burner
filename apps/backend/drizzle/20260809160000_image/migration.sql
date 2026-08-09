-- Pictures written into markdown (#379).
--
-- One table, unlike the three fixed slots — `account_avatar`, `installation_icon`,
-- `installation_banner` — because these have no owning entity: the reference lives
-- inside prose, and the only thing that owns one is the person who uploaded it. That is
-- also why the cascade is on `uploaded_by` and there is nothing else to cascade from.
--
-- Nothing sweeps orphans. A reference from markdown has no foreign key, so finding the
-- last one would mean knowing every markdown column in the schema — a list that goes one
-- column stale in silence. `schema.ts` has the rest of the reasoning.
CREATE TABLE `image` (
	`id` text NOT NULL,
	`bytes` blob NOT NULL,
	`content_type` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `image_pk` PRIMARY KEY(`id`),
	CONSTRAINT `image_uploaded_by_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT "image_type_check" CHECK("content_type" in ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
CREATE INDEX `image_uploader_idx` ON `image` (`uploaded_by`);
