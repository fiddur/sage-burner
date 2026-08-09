-- Pictures written into markdown (#379). Why one table, why a blob, why nothing sweeps
-- orphans: "Pictures in what people write" in `docs/the-app.md`.
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
