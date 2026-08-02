CREATE TABLE `attendance_helping` (
	`attendance_id` text NOT NULL,
	`option_id` text NOT NULL,
	CONSTRAINT `attendance_helping_pk` PRIMARY KEY(`attendance_id`, `option_id`),
	CONSTRAINT `fk_attendance_helping_attendance_id_attendance_id_fk` FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_attendance_helping_option_id_event_option_id_fk` FOREIGN KEY (`option_id`) REFERENCES `event_option`(`id`) ON DELETE CASCADE
);
