CREATE TABLE `installation` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	CONSTRAINT "installation_singleton_check" CHECK("id" = 'installation'),
	CONSTRAINT "installation_title_check" CHECK(length(trim("title")) > 0)
);
--> statement-breakpoint
INSERT INTO `installation` (`id`, `title`) VALUES ('installation', 'Sage Burner');
