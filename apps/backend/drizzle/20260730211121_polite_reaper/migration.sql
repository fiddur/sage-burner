PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_form_question` (
	`id` text PRIMARY KEY NOT NULL,
	`order` integer NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`help_text` text,
	`required` integer DEFAULT false NOT NULL,
	`options` text,
	CONSTRAINT "form_question_type_check" CHECK("type" in ('text', 'textarea', 'checkbox', 'agreement')),
	CONSTRAINT "form_question_order_check" CHECK("order" >= 0),
	CONSTRAINT "form_question_required_check" CHECK("required" in (0, 1)),
	CONSTRAINT "form_question_checkbox_required_check" CHECK("type" <> 'checkbox' or "required" = 0),
	CONSTRAINT "form_question_agreement_required_check" CHECK("type" <> 'agreement' or "required" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_form_question`(`id`, `order`, `type`, `label`, `help_text`, `required`, `options`) SELECT `id`, `order`, `type`, `label`, `help_text`, CASE `type` WHEN 'agreement' THEN 1 WHEN 'checkbox' THEN 0 ELSE `required` END, `options` FROM `form_question`;--> statement-breakpoint
DROP TABLE `form_question`;--> statement-breakpoint
ALTER TABLE `__new_form_question` RENAME TO `form_question`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `form_question_event_order_idx`;--> statement-breakpoint
CREATE INDEX `form_question_order_idx` ON `form_question` (`order`);