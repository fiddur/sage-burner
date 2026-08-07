-- The Q&A the spreadsheet had a tab for (#28). Per burn; `schemas/faq.ts` says why.
--
-- The CHECK is on the question alone — an entry with no answer yet is a question
-- somebody has asked and nobody has got to, which is worth having on the page rather
-- than refusing.
CREATE TABLE `faq_entry` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`order` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `faq_entry_pk` PRIMARY KEY(`id`),
	CONSTRAINT `faq_entry_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE cascade,
	CONSTRAINT "faq_entry_question_check" CHECK(length(trim("question")) > 0)
);
--> statement-breakpoint
CREATE INDEX `faq_entry_event_idx` ON `faq_entry` (`event_id`,`order`);
