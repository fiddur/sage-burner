import type { CopySourcesResponse } from '@sage-burner/shared'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import { asc, count, desc, eq, ne } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { event } from '../db/schema.ts'

/**
 * The other burns whose list this burn's could be seeded from, newest first.
 *
 * One query for every per-burn list that offers copying — the lead-roles register
 * and the schedule's places today. Written out per list it was the same four
 * clauses twice, and the ordering rule is the sort of thing that ends up meaning
 * something slightly different in each copy.
 *
 * The caller names its own list: the table to join, its `event_id`, and the column
 * to count. Only burns that hold something appear, and only their name — a burn's
 * dates and cap are not a member's to read.
 */
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
