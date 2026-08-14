import { and, eq, isNull, lt, or } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { account } from '../db/schema.ts'

export const ACTIVE_EVERY_MS = 60 * 60 * 1000

/**
 * "Has been on the site", which nothing recorded: a session is a signed cookie with no row behind
 * it. The staleness test is the UPDATE's own `WHERE`, so this is one write and no read, and it
 * changes nothing on all but the first request of an hour.
 */
export const markActive = async (db: Database, accountId: string, at: Date): Promise<void> => {
  const stale = new Date(at.getTime() - ACTIVE_EVERY_MS).toISOString()

  await db
    .update(account)
    .set({ last_active_at: at.toISOString() })
    .where(
      and(eq(account.id, accountId), or(isNull(account.last_active_at), lt(account.last_active_at, stale))),
    )
}
