-- The Q&A the spreadsheet had a tab for (#28).
--
-- Per burn, like the places and the lead-roles register: how to get there and what
-- to bring change with the site and the year, and last summer's directions are wrong
-- for the next one. The copy action is what makes that cheap — most answers carry
-- over, and retyping fifteen of them four times a year is the friction worth
-- removing, exactly as it was for the roles.
--
-- `question` is plain text and `answer` is markdown, which is the split every pair
-- like this has here: the short one is a heading, the long one is written for other
-- people to read. The CHECK is on the question alone — an entry with no answer yet is
-- a question somebody has asked and nobody has got to, which is worth having on the
-- page rather than refusing.
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
