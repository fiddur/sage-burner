-- A schedule line carries the slot before and after the move; `docs/the-app.md` ("Feed") has the why.
ALTER TABLE `thread_entry` ADD `change` text;
