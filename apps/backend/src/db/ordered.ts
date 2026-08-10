import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import { and, desc, eq } from 'drizzle-orm'

import type { Database, Transaction } from './index.ts'

export interface OrderedColumns {
  id: SQLiteColumn
  order: SQLiteColumn
}

export const nextOrder = (tx: Transaction, table: SQLiteTable & OrderedColumns, scope?: SQL): number => {
  const query = tx.select({ order: table.order }).from(table)
  const [last] = (scope === undefined ? query : query.where(scope)).orderBy(desc(table.order)).limit(1).all()

  return last === undefined ? 0 : Number(last.order) + 1
}

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
