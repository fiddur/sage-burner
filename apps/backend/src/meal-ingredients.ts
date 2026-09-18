import type { AllergyTag, MealIngredient, PantryPlacing } from '@sage-burner/shared'

import { asc, eq, inArray, sql } from 'drizzle-orm'

import type { Database } from './db/index.ts'

import { account, mealIngredient, pantryItem } from './db/schema.ts'
import { tagsFor } from './pantry-allergies.ts'
import { placesFor } from './pantry-places.ts'

const lines = (db: Database) =>
  db
    .select({
      id: mealIngredient.id,
      meal_id: mealIngredient.meal_id,
      pantry_item_id: mealIngredient.pantry_item_id,
      written_name: mealIngredient.name,
      written_unit: mealIngredient.unit,
      amount: mealIngredient.amount,
      bought_by: mealIngredient.bought_by,
      bought_by_name: account.name,
      bought_at: mealIngredient.bought_at,
      pantry_name: pantryItem.name,
      pantry_unit: pantryItem.unit,
      stock_level: pantryItem.stock_level,
      stock_amount: pantryItem.stock_amount,
    })
    .from(mealIngredient)
    .leftJoin(pantryItem, eq(pantryItem.id, mealIngredient.pantry_item_id))
    .leftJoin(account, eq(account.id, mealIngredient.bought_by))

type Line = Awaited<ReturnType<typeof lines>>[number]

const asIngredient = (
  row: Line,
  tags: ReadonlyMap<string, AllergyTag[]>,
  places: ReadonlyMap<string, PantryPlacing[]>,
): MealIngredient => ({
  id: row.id,
  pantry_item_id: row.pantry_item_id,
  name: row.pantry_name ?? row.written_name ?? '',
  unit: row.pantry_unit ?? row.written_unit ?? '',
  amount: row.amount,
  bought:
    row.bought_at === null ? null : { by: row.bought_by, by_name: row.bought_by_name, at: row.bought_at },
  pantry:
    row.pantry_item_id === null
      ? null
      : {
          places: places.get(row.pantry_item_id) ?? [],
          stock_level: row.stock_level,
          stock_amount: row.stock_amount,
          allergies: tags.get(row.pantry_item_id) ?? [],
        },
})

export const ingredientsFor = async (
  db: Database,
  mealIds: readonly string[],
): Promise<ReadonlyMap<string, MealIngredient[]>> => {
  const held = new Map<string, MealIngredient[]>()
  if (mealIds.length === 0) return held

  const rows = await lines(db)
    .where(inArray(mealIngredient.meal_id, [...mealIds]))
    .orderBy(asc(mealIngredient.created_at), sql`"meal_ingredient"."rowid"`)

  const picked = rows.map((row) => row.pantry_item_id).filter((id) => id !== null)
  const [tags, places] = await Promise.all([tagsFor(db, picked), placesFor(db, picked)])

  for (const row of rows) {
    held.set(row.meal_id, [...(held.get(row.meal_id) ?? []), asIngredient(row, tags, places)])
  }

  return held
}
