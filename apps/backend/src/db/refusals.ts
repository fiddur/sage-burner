/**
 * Reading a refusal: why a write that should have landed did not.
 *
 * Beside `errors.ts`, which interprets the failures a driver *throws*. This one is
 * about the quieter kind — a statement that ran, matched nothing, and said nothing
 * about why.
 */

import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { Database } from './index.ts'

/**
 * Why a conditional write matched nothing.
 *
 * Every write here that has to refuse something puts the refusal in the statement's
 * own `WHERE` rather than in a read before it, so the decision and the guard against
 * a concurrent change are one thing. The cost is that zero rows written has two
 * causes — the row is gone, or the condition said no — and they want different
 * answers: a 404, or whatever that route's refusal means.
 *
 * **Asked rather than inferred.** Guessing from whether a condition was present
 * answered "Request failed (400)" for a question that was simply not there, which is
 * the wrong end of the problem to send somebody looking at.
 *
 * `row` is how to find it again, which is not always the id: an attendance is found
 * by the pair it belongs to, not by a key anybody sent.
 */
export const whyNothingWritten = async (
  db: Database,
  table: SQLiteTable & { id: SQLiteColumn },
  row: SQL,
): Promise<'not_found' | 'refused'> => {
  const [found] = await db.select({ id: table.id }).from(table).where(row).limit(1)

  return found === undefined ? 'not_found' : 'refused'
}
