PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_form_question` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`order` integer NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`help_text` text,
	`required` integer DEFAULT false NOT NULL,
	`options` text,
	CONSTRAINT `fk_form_question_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT "form_question_type_check" CHECK("type" in ('text', 'textarea', 'checkbox', 'agreement')),
	CONSTRAINT "form_question_order_check" CHECK("order" >= 0),
	CONSTRAINT "form_question_required_check" CHECK("required" in (0, 1)),
	CONSTRAINT "form_question_agreement_required_check" CHECK("type" <> 'agreement' or "required" = 1),
	CONSTRAINT "form_question_checkbox_optional_check" CHECK("type" <> 'checkbox' or "required" = 0)
);
--> statement-breakpoint
INSERT INTO `__new_form_question`(`id`, `event_id`, `order`, `type`, `label`, `help_text`, `required`, `options`) SELECT `id`, `event_id`, `order`, `type`, `label`, `help_text`, `required`, `options` FROM `form_question`;--> statement-breakpoint
DROP TABLE `form_question`;--> statement-breakpoint
ALTER TABLE `__new_form_question` RENAME TO `form_question`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `form_question_event_order_idx` ON `form_question` (`event_id`,`order`);