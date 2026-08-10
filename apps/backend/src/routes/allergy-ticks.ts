import { asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { accountAllergy, allergyItem } from '../db/schema.ts'

export const allergyTicksFor = async (db: Database, accountIds: readonly string[]) => {
  if (accountIds.length === 0) return new Map<string, string[]>()

  const rows = await db
    .select()
    .from(accountAllergy)
    .where(inArray(accountAllergy.account_id, [...accountIds]))

  const byAccount = new Map<string, string[]>()
  for (const row of rows) {
    byAccount.set(row.account_id, [...(byAccount.get(row.account_id) ?? []), row.item_id])
  }

  return byAccount
}

export const allergyTickIdsFor = async (db: Database, accountId: string) =>
  (await allergyTicksFor(db, [accountId])).get(accountId) ?? []

type Writer = Pick<Database, 'delete' | 'insert'>

export const writeAllergyTicks = (writer: Writer, accountId: string, itemIds: readonly string[]): void => {
  writer.delete(accountAllergy).where(eq(accountAllergy.account_id, accountId)).run()

  for (const item_id of new Set(itemIds)) {
    writer.insert(accountAllergy).values({ account_id: accountId, item_id }).run()
  }
}

export const allergyLabelsFor = async (db: Database, accountIds: readonly string[]) => {
  if (accountIds.length === 0) return new Map<string, string[]>()

  const rows = await db
    .select({
      account_id: accountAllergy.account_id,
      label: allergyItem.label,
      order: allergyItem.order,
    })
    .from(accountAllergy)
    .innerJoin(allergyItem, eq(allergyItem.id, accountAllergy.item_id))
    .where(inArray(accountAllergy.account_id, [...accountIds]))
    .orderBy(asc(allergyItem.order), asc(allergyItem.id))

  const byAccount = new Map<string, string[]>()
  for (const row of rows) {
    byAccount.set(row.account_id, [...(byAccount.get(row.account_id) ?? []), row.label])
  }

  return byAccount
}
