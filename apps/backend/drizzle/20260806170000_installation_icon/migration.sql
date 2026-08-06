-- The icon an installed copy of this app wears on a home screen (#256).
--
-- In the database for the same reason as an avatar and the VAPID keys: the container
-- has no writable path but the data volume, and `docker compose up` has to stay
-- sufficient. Its own table rather than a column on `installation`, which is read for
-- a title on nearly every page load and has no business carrying an image.
--
-- The singleton CHECK mirrors `installation`'s: there is one deployment, so there is
-- one icon, and no read has to decide which row is authoritative.
--
-- Two content types and no more. PNG is what a canvas produces from whatever the
-- admin picked; SVG is stored exactly as authored, because rasterising a logo to 512
-- pixels throws away the reason it was an SVG. Nothing in this process decodes either.
CREATE TABLE `installation_icon` (
	`id` text NOT NULL,
	`image` blob NOT NULL,
	`content_type` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `installation_icon_pk` PRIMARY KEY(`id`),
	CONSTRAINT "installation_icon_singleton_check" CHECK("id" = 'installation'),
	CONSTRAINT "installation_icon_type_check" CHECK("content_type" in ('image/png', 'image/svg+xml'))
);
