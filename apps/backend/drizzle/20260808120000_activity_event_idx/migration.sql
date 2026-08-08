-- For the cascade — `schema.ts` says why (#333).
CREATE INDEX `activity_event_idx` ON `activity` (`event_id`);
