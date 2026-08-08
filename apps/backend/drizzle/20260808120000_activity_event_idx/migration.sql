-- The feed's rows cascade with their burn (#303), and without this that delete scans
-- the table for every row it has to check. Trivial at this size — a burn has tens of
-- lines — and it is one line (#333).
CREATE INDEX `activity_event_idx` ON `activity` (`event_id`);
