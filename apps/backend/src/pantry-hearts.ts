import type { EventPantryItem, PantryBought, PantryHearts, PantryItem } from '@sage-burner/shared'

import { asc, eq } from 'drizzle-orm'

import type { Database } from './db/index.ts'

import { account, accountAvatar, attendance, pantryHeart, pantryPurchase } from './db/schema.ts'

const heartRows = async (db: Database, eventId: string) =>
  await db
    .select({
      item_id: pantryHeart.item_id,
      attendance_id: pantryHeart.attendance_id,
      account_id: account.id,
      name: account.name,
      avatar: accountAvatar.updated_at,
    })
    .from(pantryHeart)
    .innerJoin(attendance, eq(attendance.id, pantryHeart.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
    .where(eq(attendance.event_id, eventId))
    .orderBy(asc(account.name), asc(account.id))

export const heartsFor = async (
  db: Database,
  eventId: string,
  mine: string | undefined,
): Promise<ReadonlyMap<string, PantryHearts>> => {
  const held = new Map<string, PantryHearts>()

  for (const row of await heartRows(db, eventId)) {
    const so_far = held.get(row.item_id) ?? { count: 0, people: [], mine: false }

    held.set(row.item_id, {
      count: so_far.count + 1,
      people: [...so_far.people, { account_id: row.account_id, name: row.name, avatar: row.avatar }],
      mine: so_far.mine || row.attendance_id === mine,
    })
  }

  return held
}

export const purchasesFor = async (
  db: Database,
  eventId: string,
): Promise<ReadonlyMap<string, PantryBought>> => {
  const rows = await db
    .select({
      item_id: pantryPurchase.item_id,
      by: pantryPurchase.bought_by,
      by_name: account.name,
      at: pantryPurchase.bought_at,
    })
    .from(pantryPurchase)
    .leftJoin(account, eq(account.id, pantryPurchase.bought_by))
    .where(eq(pantryPurchase.event_id, eventId))

  return new Map(rows.map(({ item_id, ...bought }) => [item_id, bought]))
}

export const withHeartsAndTicks = (
  items: readonly PantryItem[],
  hearts: ReadonlyMap<string, PantryHearts>,
  bought: ReadonlyMap<string, PantryBought>,
): EventPantryItem[] =>
  items.map((item) => ({
    ...item,
    hearts: hearts.get(item.id) ?? { count: 0, people: [], mine: false },
    bought: bought.get(item.id) ?? null,
  }))
