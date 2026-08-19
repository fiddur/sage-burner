-- What the provider calls the person, on the identity row, so the review card can say it.
-- "Which door an applicant came in through" in `docs/accounts.md` has the why.
ALTER TABLE `account_identity` ADD `name` text;--> statement-breakpoint
ALTER TABLE `account_identity` ADD `handle` text;
