-- The feed lines meetings had for a day (#608). Between #592 and #603 a scheduled meeting wrote an
-- `activity` row, because it had no card to be its presence on the feed; #603 gave it one and
-- stopped writing them. The rows already written stay for ever — nothing deletes an `activity` row
-- except its burn going — so a meeting scheduled that day is on the feed as a line as well as a
-- card, and stays there after the meeting itself is taken out of the diary.
--
-- Deleting them by category rather than by id: `meeting_scheduled` is the only category that was
-- ever written to `activity` by that half-day's code, and nothing writes it there now.
DELETE FROM `activity` WHERE `category` = 'meeting_scheduled';
