import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import { and, desc, eq } from 'drizzle-orm'

import type { Database, Transaction } from './index.ts'

/**
 * Lists a person put in an order, and the two writes that keep them in one.
 *
 * Three tables carry an `order` an admin drags around — `place`, `form_question`,
 * `event_option` — and each had written out the same two blocks: read the last
 * position and insert after it, and renumber a whole list from a set of ids. Six
 * blocks, three copies of the "the server assigns `order`" argument, and three
 * chances for the same-set rule to be a little different from the other two.
 *
 * The invariants live here now: **the server assigns the position**, and **a reorder
 * names every row exactly once or is refused**.
 */

/**
 * Enough of a table to be ordered: something to name a row by, and somewhere to put
 * it. Drizzle's tables satisfy this structurally, so nothing has to be cast.
 */
export interface OrderedColumns {
  id: SQLiteColumn
  order: SQLiteColumn
}

/**
 * The next free position, inside the caller's own transaction.
 *
 * **Read and insert must be one transaction**, or "the server assigns `order`" is
 * not true: two adds can observe the same last row between separate awaits and claim
 * the same position. The caller owns the transaction rather than this — each has
 * something else to do inside it, and each answers a foreign key violation
 * differently — so this is the read alone, and it takes a `tx` to make that hard to
 * get wrong.
 *
 * `scope` is what the list is numbered within: a burn for places, a burn and a kind
 * for the options, nothing at all for the application's questions. Numbering across
 * all burns would start a new burn's first lane wherever the previous one stopped.
 */
export const nextOrder = (tx: Transaction, table: SQLiteTable & OrderedColumns, scope?: SQL): number => {
  const query = tx.select({ order: table.order }).from(table)
  const [last] = (scope === undefined ? query : query.where(scope)).orderBy(desc(table.order)).limit(1).all()

  return last === undefined ? 0 : Number(last.order) + 1
}

/**
 * Renumber a whole list from the ids it should read in, or refuse.
 *
 * **Exactly the rows this list has, no more and no fewer.** A partial list would
 * renumber some rows and leave the rest on stale positions, producing an order
 * nobody chose; an id from another burn would reach into a list this request is not
 * about. Distinctness is implied rather than checked: `wanted` has exactly as many
 * slots as there are rows and must contain every one of them, and those are distinct
 * because `id` is the primary key.
 *
 * One statement per row, but in a transaction: a half-applied reorder is an order
 * nobody chose. `scope` is ANDed into every one of them, so an id from another burn
 * could not renumber it even if the set check were wrong.
 */
export const reorder = (
  db: Database,
  table: SQLiteTable & OrderedColumns,
  existing: readonly { id: string }[],
  wanted: readonly string[],
  scope?: SQL,
): 'mismatch' | 'ok' => {
  const sameSet = wanted.length === existing.length && existing.every((row) => wanted.includes(row.id))
  if (!sameSet) return 'mismatch'

  db.transaction((tx) => {
    wanted.forEach((id, index) => {
      const at = eq(table.id, id)
      tx.update(table)
        .set({ order: index })
        .where(scope === undefined ? at : and(at, scope))
        .run()
    })
  })

  return 'ok'
}
