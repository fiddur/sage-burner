import { asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { accountAllergy, allergyItem } from '../db/schema.ts'

/**
 * Which allergy items a set of people ticked, as ids per account (#254).
 *
 * One query for all of them rather than one each, like `helpingFor` — the caller
 * usually has a whole roster in hand.
 *
 * Keyed on the **account**, not a stay: allergies describe a human, and held per
 * burn a correction would leave every other burn wrong.
 */
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

/** The ids for one person, which is the case at their own routes. */
export const allergyTickIdsFor = async (db: Database, accountId: string) =>
  (await allergyTicksFor(db, [accountId])).get(accountId) ?? []

/**
 * Whether every id is a real item.
 *
 * Asked before anything is written, like `areHelpingOptions`: the profile form sends
 * the ticks and the columns in one PATCH, so rejecting them afterwards would answer
 * 400 with the name already saved.
 */
export const areAllergyItems = async (db: Database, itemIds: readonly string[]): Promise<boolean> => {
  const wanted = [...new Set(itemIds)]
  if (wanted.length === 0) return true

  const real = await db.select({ id: allergyItem.id }).from(allergyItem)
  const allowed = new Set(real.map((row) => row.id))

  return wanted.every((id) => allowed.has(id))
}

/** Enough of a handle to write with, so a transaction can be passed in as one. */
type Writer = Pick<Database, 'delete' | 'insert'>

/**
 * Replace one person's ticks with exactly these items.
 *
 * Delete-then-insert rather than a diff, for the reason `writeHelping` gives: at a
 * handful of rows the diff is more code than it saves, and the set is the same
 * either way. Takes the writer so the caller's transaction covers both halves of a
 * PATCH that carries columns and ticks together.
 */
export const writeAllergyTicks = (writer: Writer, accountId: string, itemIds: readonly string[]): void => {
  writer.delete(accountAllergy).where(eq(accountAllergy.account_id, accountId)).run()

  for (const item_id of new Set(itemIds)) {
    writer.insert(accountAllergy).values({ account_id: accountId, item_id }).run()
  }
}

/**
 * The same ticks, with their labels.
 *
 * Whoever cooks reads this; a column of UUIDs is not something to cook from.
 */
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
    .orderBy(asc(allergyItem.order), asc(allergyItem.label))

  const byAccount = new Map<string, string[]>()
  for (const row of rows) {
    byAccount.set(row.account_id, [...(byAccount.get(row.account_id) ?? []), row.label])
  }

  return byAccount
}
