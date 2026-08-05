-- Helpers on a dream, and the ❤️‍🔥 people give it (#198).
--
-- Both key on `attendance` rather than `account`: only somebody coming can carry
-- the cushions, and withdrawing from the burn takes their offers of help and their
-- hearts with them rather than leaving names nobody can reach.
--
-- The support count is not a column. A row per person makes the primary key the
-- whole "one heart each" rule, so clicking twice cannot inflate it and nothing can
-- drift; the number is derived on every read.
CREATE TABLE `session_helper` (
	`session_id` text NOT NULL,
	`attendance_id` text NOT NULL,
	CONSTRAINT `session_helper_pk` PRIMARY KEY(`session_id`, `attendance_id`),
	CONSTRAINT `fk_session_helper_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_helper_attendance_id_attendance_id_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_support` (
	`session_id` text NOT NULL,
	`attendance_id` text NOT NULL,
	CONSTRAINT `session_support_pk` PRIMARY KEY(`session_id`, `attendance_id`),
	CONSTRAINT `fk_session_support_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_support_attendance_id_attendance_id_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE
);
