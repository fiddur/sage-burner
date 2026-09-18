import type { AllergyTag } from '@sage-burner/shared'

import { asc, eq, inArray } from 'drizzle-orm'

import type { Database } from './db/index.ts'

import { allergyItem, pantryItemAllergy } from './db/schema.ts'

export const tagsFor = async (
  db: Database,
  itemIds?: readonly string[],
): Promise<ReadonlyMap<string, AllergyTag[]>> => {
  const held = new Map<string, AllergyTag[]>()
  if (itemIds?.length === 0) return held

  const rows = await db
    .select({
      item_id: pantryItemAllergy.item_id,
      id: allergyItem.id,
      label: allergyItem.label,
    })
    .from(pantryItemAllergy)
    .innerJoin(allergyItem, eq(allergyItem.id, pantryItemAllergy.allergy_item_id))
    .where(itemIds === undefined ? undefined : inArray(pantryItemAllergy.item_id, [...itemIds]))
    .orderBy(asc(allergyItem.order), asc(allergyItem.id))

  for (const row of rows) {
    held.set(row.item_id, [...(held.get(row.item_id) ?? []), { id: row.id, label: row.label }])
  }

  return held
}

export const knownTags = async (
  db: Database,
  ids: readonly string[],
): Promise<readonly string[] | undefined> => {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return wanted

  const found = await db
    .select({ id: allergyItem.id })
    .from(allergyItem)
    .where(inArray(allergyItem.id, wanted))

  return found.length === wanted.length ? wanted : undefined
}

export const setTags = async (db: Database, itemId: string, ids: readonly string[]): Promise<void> => {
  await db.delete(pantryItemAllergy).where(eq(pantryItemAllergy.item_id, itemId))

  if (ids.length > 0) {
    await db
      .insert(pantryItemAllergy)
      .values(ids.map((allergy_item_id) => ({ item_id: itemId, allergy_item_id })))
  }
}
