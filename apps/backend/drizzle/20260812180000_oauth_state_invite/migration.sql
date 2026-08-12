-- A group link is posted inside the group it vets, which is a Facebook group or a Discord
-- server — so the provider somebody already uses there is the account they want, and typing an
-- address and a password is the long way round. The round trip has to remember which invite it
-- set off from, and it carries the digest rather than the token: `oauth_state` is a row, and a
-- live credential in one is a credential at rest for no reason. `digestOf` is the same hash
-- `invite_token.token_hash` already holds, so the callback matches on it directly.
ALTER TABLE `oauth_state` ADD COLUMN `invite_token_hash` text;
