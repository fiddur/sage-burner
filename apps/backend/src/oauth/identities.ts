import type { Identity, OAuthProvider } from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'

import { asc, eq, sql } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { account, accountIdentity, passkey } from '../db/schema.ts'

/**
 * The ways in somebody has linked (#393).
 *
 * The provider and when, and deliberately not `subject`: nothing needs to read it back, and
 * Facebook's is app-scoped while Discord's is a global snowflake — so one of the two would be
 * comparable across installations if it ever left this process.
 */
export const identitiesFor = async (db: Database, accountId: string): Promise<Identity[]> =>
  await db
    .select({ provider: accountIdentity.provider, created_at: accountIdentity.created_at })
    .from(accountIdentity)
    .where(eq(accountIdentity.account_id, accountId))
    .orderBy(asc(accountIdentity.created_at))

/**
 * Whether taking one way in away would leave another, as a condition for the DELETE's own
 * `WHERE`.
 *
 * A password, a passkey, or an identity from a different provider — any one is enough. This
 * is `removePasskey`'s 409 generalised: **a way in is an extra way in, never the only one
 * imposed** (#9), and the same sentence read backwards says an account must not be left with
 * none. Somebody who signed up with Discord and set no password has exactly one, and losing
 * it locks them out of a burn they have paid for.
 *
 * **A condition rather than a read before the write** (#239's shape, and `removePasskey`'s).
 * Checked in its own statement, two removals in two tabs — a Discord identity and a Facebook
 * one, on an account with no password — could each see the other as the survivor, both pass,
 * and together leave the account with no way in at all. Evaluated inside the DELETE, the
 * second one matches nothing.
 *
 * This and `removePasskey` are the only two places in the app that engineer for a race. Not
 * because either window is realistic, but because the consequence is permanent and nothing
 * in the app lets somebody back in — the password reset is an admin's.
 */
export const anotherWayInSurvives = (accountId: string, losing: OAuthProvider): SQL => sql`(
  exists (
    select 1 from ${account}
    where ${account.id} = ${accountId} and ${account.password_hash} is not null
  )
  or exists (select 1 from ${passkey} where ${passkey.account_id} = ${accountId})
  or exists (
    select 1 from ${accountIdentity}
    where ${accountIdentity.account_id} = ${accountId} and ${accountIdentity.provider} <> ${losing}
  )
)`
