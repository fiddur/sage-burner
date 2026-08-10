import type { CopySourcesResponse } from '@sage-burner/shared'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import { asc, count, desc, eq, ne } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { event } from '../db/schema.ts'

export const copySourcesFor = async (
  db: Database,
  list: { table: SQLiteTable; eventColumn: SQLiteColumn; idColumn: SQLiteColumn },
  eventId: string,
): Promise<CopySourcesResponse['sources']> =>
  db
    .select({ event_id: event.id, name: event.name, count: count(list.idColumn) })
    .from(event)
    .innerJoin(list.table, eq(list.eventColumn, event.id))
    .where(ne(event.id, eventId))
    .groupBy(event.id)
    .orderBy(desc(event.start_date), asc(event.slug))
