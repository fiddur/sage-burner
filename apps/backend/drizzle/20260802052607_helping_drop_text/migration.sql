-- Straight across: what someone typed about helping out is still what they typed
-- about helping out, and `helping_other` is where the write-in lives now. Unlike
-- the lodging text, this needs no reinterpretation.
UPDATE `attendance`
SET `helping_other` = trim(`shift_preference`)
WHERE `shift_preference` IS NOT NULL AND trim(`shift_preference`) <> '';
--> statement-breakpoint
ALTER TABLE `attendance` DROP COLUMN `shift_preference`;
