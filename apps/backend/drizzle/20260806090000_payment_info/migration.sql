-- How to pay for this burn, shown on the Members page to whoever has not (#250).
--
-- On `event` rather than `installation`: the amount, the account and the deadline are
-- facts about one gathering, and last summer's are wrong for the next one.
ALTER TABLE `event` ADD `payment_info_markdown` text DEFAULT '' NOT NULL;
