-- The picture a link to this installation shows, and where the burn is held (#306).
--
-- A share card is built from `<meta>` tags in the shell, so both halves of it have to
-- be readable by the process that serves the HTML: the image it points at, and enough
-- about the burn to describe it.
--
-- `installation_banner` sits beside `installation_icon` rather than in it, for the
-- reason that one gives: two images with different shapes, different callers and
-- different lifetimes, and `installation` itself is read for a title on nearly every
-- page load. The singleton CHECK mirrors both.
--
-- No `content_type` column. The banner is a JPEG and can be nothing else — every
-- crawler draws one, an SVG would leave the card blank, and a 1200 × 630 PNG of a
-- photograph is a megabyte the public homepage would load — so the route serves that
-- constant and there is no second spelling of it to keep in step.
CREATE TABLE `installation_banner` (
	`id` text NOT NULL,
	`image` blob NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `installation_banner_pk` PRIMARY KEY(`id`),
	CONSTRAINT "installation_banner_singleton_check" CHECK("id" = 'installation')
);
--> statement-breakpoint
-- Where the burn is held, per burn rather than per installation: the same people meet
-- at a different farm next time. Public — it is on the homepage and in the card's
-- structured data, which is what puts a burn on a map for somebody deciding whether to
-- apply. Empty for every existing row, which is what having no answer looks like.
ALTER TABLE `event` ADD `location` text DEFAULT '' NOT NULL;
