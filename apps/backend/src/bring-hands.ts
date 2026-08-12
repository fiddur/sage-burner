import type { BringEntry } from '@sage-burner/shared'

import { asc, eq, inArray } from 'drizzle-orm'

import type { Database } from './db/index.ts'

import { account, attendance, bringHand } from './db/schema.ts'

export const handsFor = async (
  db: Database,
  itemIds: readonly string[],
): Promise<ReadonlyMap<string, BringEntry['hands']>> => {
  if (itemIds.length === 0) return new Map()

  const rows = await db
    .select({ item_id: bringHand.item_id, account_id: account.id, name: account.name })
    .from(bringHand)
    .innerJoin(attendance, eq(attendance.id, bringHand.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .where(inArray(bringHand.item_id, [...itemIds]))
    .orderBy(asc(account.name), asc(account.id))

  const held = new Map<string, BringEntry['hands']>()
  for (const row of rows) {
    held.set(row.item_id, [...(held.get(row.item_id) ?? []), { account_id: row.account_id, name: row.name }])
  }

  return held
}

export const handsOn = async (db: Database, itemId: string): Promise<BringEntry['hands']> =>
  (await handsFor(db, [itemId])).get(itemId) ?? []
