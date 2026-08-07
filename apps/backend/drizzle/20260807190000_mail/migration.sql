-- Email: where this installation posts from, and who wants to hear that way (#30).
--
-- `mail_setting` is a singleton beside `installation` rather than columns on it, for
-- the reason `installation_icon` gives: that row is read for a title on nearly every
-- page load, and an SMTP password should not ride along on each of them. No row is
-- the ordinary state — nothing in this app requires email, nothing fails without it,
-- and an installation that never sets one up never has one.
--
-- The password is stored as given, because SMTP AUTH sends the password itself and a
-- digest would be one this app could not use. Same class of secret as
-- `installation.vapid_private_key`, kept safe by the volume rather than the column.
CREATE TABLE `mail_setting` (
	`id` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`secure` integer NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `mail_setting_pk` PRIMARY KEY(`id`),
	CONSTRAINT "mail_setting_singleton_check" CHECK("id" = 'installation'),
	CONSTRAINT "mail_setting_port_check" CHECK("port" BETWEEN 1 AND 65535),
	CONSTRAINT "mail_setting_host_check" CHECK(length(trim("host")) > 0),
	CONSTRAINT "mail_setting_from_check" CHECK(length(trim("from_email")) > 0)
);
--> statement-breakpoint
-- The second channel, per category, beside the bell's own switch.
--
-- `DEFAULT 0` rather than a value chosen per row: email is off for every category
-- until somebody asks for it, so the rows already here need no decision made for
-- them — and an upgrade must never be what starts posting to somebody's inbox.
ALTER TABLE `notification_setting` ADD `email` integer DEFAULT false NOT NULL;
