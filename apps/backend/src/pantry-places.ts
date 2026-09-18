import type { PantryPlace, PantryPlacement, PantryPlacing } from '@sage-burner/shared'

import { asc, eq, inArray } from 'drizzle-orm'

import type { Database } from './db/index.ts'

import { pantryItemPlace, pantryPlace } from './db/schema.ts'

export const pantryPlacesFor = (db: Database): Promise<PantryPlace[]> =>
  db.select().from(pantryPlace).orderBy(asc(pantryPlace.order), asc(pantryPlace.id))

export const placesFor = async (
  db: Database,
  itemIds?: readonly string[],
): Promise<ReadonlyMap<string, PantryPlacing[]>> => {
  const held = new Map<string, PantryPlacing[]>()
  if (itemIds?.length === 0) return held

  const rows = await db
    .select({
      item_id: pantryItemPlace.item_id,
      place_id: pantryPlace.id,
      name: pantryPlace.name,
      spot: pantryItemPlace.spot,
    })
    .from(pantryItemPlace)
    .innerJoin(pantryPlace, eq(pantryPlace.id, pantryItemPlace.place_id))
    .where(itemIds === undefined ? undefined : inArray(pantryItemPlace.item_id, [...itemIds]))
    .orderBy(asc(pantryPlace.order), asc(pantryPlace.id))

  for (const { item_id, ...placing } of rows) {
    held.set(item_id, [...(held.get(item_id) ?? []), placing])
  }

  return held
}

export const knownPlacements = async (
  db: Database,
  placements: readonly PantryPlacement[],
): Promise<readonly PantryPlacement[] | undefined> => {
  const wanted = [...new Map(placements.map((one) => [one.place_id, one])).values()]
  if (wanted.length === 0) return wanted

  const found = await db
    .select({ id: pantryPlace.id })
    .from(pantryPlace)
    .where(
      inArray(
        pantryPlace.id,
        wanted.map((one) => one.place_id),
      ),
    )

  return found.length === wanted.length ? wanted : undefined
}

export const setPlaces = async (
  db: Database,
  itemId: string,
  placements: readonly PantryPlacement[],
): Promise<void> => {
  await db.delete(pantryItemPlace).where(eq(pantryItemPlace.item_id, itemId))

  if (placements.length > 0) {
    await db
      .insert(pantryItemPlace)
      .values(placements.map(({ place_id, spot }) => ({ item_id: itemId, place_id, spot })))
  }
}
