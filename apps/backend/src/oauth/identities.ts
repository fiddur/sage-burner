import type { Identity, OAuthProvider } from '@sage-burner/shared'

import { and, asc, eq, ne } from 'drizzle-orm'

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
 * Whether taking one way in away would leave another.
 *
 * A password, a passkey, or an identity from a different provider — any one is enough. This
 * is `removePasskey`'s 409 generalised: **a way in is an extra way in, never the only one
 * imposed** (#9), and the same sentence read backwards says an account must not be left with
 * none. Somebody who signed up with Discord and set no password has exactly one, and losing
 * it locks them out of a burn they have paid for.
 *
 * Three reads rather than one clever query: they are indexed lookups on a 42-row table, and
 * the version that reads plainly is the one somebody can check against the sentence above.
 */
export const hasAnotherWayIn = async (
  db: Database,
  accountId: string,
  losing: OAuthProvider,
): Promise<boolean> => {
  const [row] = await db
    .select({ password_hash: account.password_hash })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)

  if (row?.password_hash !== null && row?.password_hash !== undefined) return true

  const keys = await db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.account_id, accountId))
    .limit(1)

  if (keys.length > 0) return true

  const others = await db
    .select({ id: accountIdentity.id })
    .from(accountIdentity)
    .where(and(eq(accountIdentity.account_id, accountId), ne(accountIdentity.provider, losing)))
    .limit(1)

  return others.length > 0
}
