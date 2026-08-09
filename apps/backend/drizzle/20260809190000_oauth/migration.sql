-- Signing in from Discord or Facebook (#393).
--
-- Three tables and no change to `account`: a way in is something an account has, not
-- something it is, and `password_hash` is already nullable for the passkey-only case.
--
-- Keyed by provider rather than a singleton like `mail_setting`, because there are two of
-- these and the second is not hypothetical. Zero rows is the ordinary state: an
-- installation that never wants either never has one, which is what keeps
-- `docker compose up` sufficient.
CREATE TABLE `oauth_setting` (
	`provider` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `oauth_setting_pk` PRIMARY KEY(`provider`),
	CONSTRAINT "oauth_setting_provider_check" CHECK("provider" in ('discord', 'facebook')),
	CONSTRAINT "oauth_setting_client_id_check" CHECK(length(trim("client_id")) > 0)
);
--> statement-breakpoint
-- Signing in matches `(provider, subject)` and nothing else — never an email address, which
-- would be an account-takeover path the moment a provider handed over one it had not
-- verified, and would make the button an oracle for which addresses have accounts here.
--
-- `unique(provider, account_id)` as well, so an account holds at most one of each: two
-- Discords on one account is a question with no useful answer.
CREATE TABLE `account_identity` (
	`id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `account_identity_pk` PRIMARY KEY(`id`),
	CONSTRAINT `account_identity_account_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT "account_identity_provider_check" CHECK("provider" in ('discord', 'facebook'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_identity_subject_idx` ON `account_identity` (`provider`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_identity_account_idx` ON `account_identity` (`provider`,`account_id`);--> statement-breakpoint
-- One leg of a round trip, spent when it comes back. A row rather than a signed cookie for
-- the reason `webauthn_challenge` gives: single-use is what a state is for, and a cookie
-- cannot be spent.
--
-- It carries what the trip was *for*, because the two intents end differently and the
-- caller must not be the one saying which — and `account_id`, so a callback cannot attach
-- an identity to somebody else's account by arriving with a different cookie.
--
-- `nonce` is what ties the trip to the browser that started it. Unguessable and single-use
-- are both properties of the state and neither says the party who finishes is the party who
-- began: without this a member could run the flow, stop at their own callback URL and hand
-- the `?code&state` to somebody else, whose browser would be issued a session for the
-- member's account. RFC 6749 §10.12.
CREATE TABLE `oauth_state` (
	`state` text NOT NULL,
	`provider` text NOT NULL,
	`intent` text NOT NULL,
	`nonce` text NOT NULL,
	`account_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT `oauth_state_pk` PRIMARY KEY(`state`),
	CONSTRAINT `oauth_state_account_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE cascade,
	CONSTRAINT "oauth_state_provider_check" CHECK("provider" in ('discord', 'facebook')),
	CONSTRAINT "oauth_state_intent_check" CHECK("intent" in ('sign-in', 'link')),
	CONSTRAINT "oauth_state_link_account_check" CHECK("intent" <> 'link' or "account_id" is not null)
);
