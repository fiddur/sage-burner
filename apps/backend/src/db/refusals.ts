import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { Database } from './index.ts'

export const whyNothingWritten = async (
  db: Database,
  table: SQLiteTable & { id: SQLiteColumn },
  row: SQL,
): Promise<'not_found' | 'refused'> => {
  const [found] = await db.select({ id: table.id }).from(table).where(row).limit(1)

  return found === undefined ? 'not_found' : 'refused'
}
