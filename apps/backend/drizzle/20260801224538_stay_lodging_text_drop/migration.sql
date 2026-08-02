-- Keep what people typed before the lodging list existed.
--
-- There is no way to map free text onto an option — "hammock in the barn" is not
-- an id — so it is folded into `notes`, which an organiser already reads, rather
-- than dropped. Prefixed so it is obvious where it came from, and appended so an
-- existing note survives.
--
-- Truncated to 2000, which is what `attendanceSchema` allows: a longer note would
-- parse on the way in and fail the next time the member saved anything.
UPDATE `attendance`
SET `notes` = substr(
  coalesce(`notes` || char(10), '') || 'Lodging (before the list): ' || trim(`lodging`),
  1,
  2000
)
WHERE `lodging` IS NOT NULL AND trim(`lodging`) <> '';
--> statement-breakpoint
ALTER TABLE `attendance` DROP COLUMN `lodging`;
