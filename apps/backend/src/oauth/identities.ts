import type { Identity, OAuthProvider } from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'

import { asc, eq, sql } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { account, accountIdentity, passkey } from '../db/schema.ts'

export const identitiesFor = async (db: Database, accountId: string): Promise<Identity[]> =>
  await db
    .select({ provider: accountIdentity.provider, created_at: accountIdentity.created_at })
    .from(accountIdentity)
    .where(eq(accountIdentity.account_id, accountId))
    .orderBy(asc(accountIdentity.created_at))

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
