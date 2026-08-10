import type { InferInsertModel, SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { Database } from './index.ts'

import { allOf } from './conditions.ts'
import { whyNothingWritten } from './refusals.ts'

export const isEmptyPatch = (patch: object): boolean => Object.keys(patch).length === 0

export const patchRow = async <T extends SQLiteTable & { id: SQLiteColumn }>(
  db: Database,
  table: T,
  row: SQL,
  patch: Partial<InferInsertModel<T>>,
  condition?: SQL,
) => {
  if (!isEmptyPatch(patch)) {
    const written = await db.update(table).set(patch).where(allOf(row, condition)).returning({ id: table.id })

    if (written.length === 0) return { kind: await whyNothingWritten(db, table, row) }
  }

  const [found] = await db.select().from(table).where(row).limit(1)

  return found === undefined ? { kind: 'not_found' as const } : { kind: 'ok' as const, row: found }
}
