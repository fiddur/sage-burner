-- Somebody's picture for the circle in the corner (#222).
--
-- In the database, because the container has no writable path but the data volume and
-- `docker compose up` has to stay sufficient — the same argument that keeps the VAPID
-- keys here. A bind mount for uploads would be a second thing to back up.
--
-- Its own table rather than a column on `account`: avatars are tens of kilobytes and
-- `select().from(account)` is on the path of nearly every request, so a blob there
-- would be read by all of them to be used by none.
CREATE TABLE `account_avatar` (
	`account_id` text NOT NULL,
	`image` blob NOT NULL,
	`content_type` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `account_avatar_pk` PRIMARY KEY(`account_id`),
	CONSTRAINT `fk_account_avatar_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "account_avatar_type_check" CHECK("content_type" in ('image/jpeg', 'image/png', 'image/webp'))
);
