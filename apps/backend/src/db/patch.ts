/**
 * The PATCH ritual, once (#140).
 *
 * An empty patch never reaches the `UPDATE`, a non-empty one writes and asks what it
 * matched, and no row back means either the row is gone or a condition in the `WHERE`
 * said no — which are different answers.
 */

import type { InferInsertModel, SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { Database } from './index.ts'

import { allOf } from './conditions.ts'
import { whyNothingWritten } from './refusals.ts'

/**
 * Whether this patch would reach the `UPDATE` at all.
 *
 * `set({})` is not valid SQL, so a body that names no column is answered by a read
 * rather than a write — and a no-op PATCH is idempotent, so the row unchanged is the
 * honest answer. An unrecognised key is already a 400 from `.strict()`, which is why
 * `{}` is the only body left that changes nothing.
 *
 * `patchRow` applies this itself, and it is exported because six call sites need the
 * rule on its own: three writes cannot use `patchRow` at all — two inside a transaction
 * they own, one re-reading a singleton — and three that do use it answer the empty body
 * before a precondition check.
 */
export const isEmptyPatch = (patch: object): boolean => Object.keys(patch).length === 0

/**
 * Patch one row and say what happened: `ok` with the row, `not_found`, or `refused`.
 *
 * `refused` is a condition in the `WHERE` saying no, and each route words that its own
 * way — a 400 for a rule about the row, a 409 for a state it is in.
 *
 * `row` is how to find it, which is not always the id: an attendance is found by the
 * pair it belongs to. `condition` is the rule the write is only allowed under — the
 * tick-box pairing, a stay's date order — and it belongs in the statement rather than
 * in a read before it, so the decision and the guard against a concurrent change are
 * one thing.
 *
 * The write asks only for the id back, and the row the caller gets is read after it.
 * Reading `changes` would be the alternative and is worse — SQLite does not count a row
 * whose `SET` values are identical, and an id coming back means "this statement matched
 * this row" whatever it wrote. The read is *after* the write rather than before, which
 * is the half that matters: a pre-read snapshot could report a field another write has
 * since changed, and two admins patching one row with different fields would each be
 * told their own landed and the other's did not.
 *
 * A single `.returning()` would save the read, and cannot be typed here: drizzle types
 * it as `Row extends undefined ? StatementResultingChanges : Row[]`, and over a generic
 * table that conditional stays unresolved — the result cannot even be destructured. An
 * id-shaped `.returning()` types cleanly, so the choice is one extra `SELECT` per patch
 * against a cast, and at this size the query is free.
 *
 * **With no `condition`, `refused` cannot happen** — the `UPDATE` and the re-read
 * share one `WHERE` — so a caller passing none may answer anything but `ok` with a
 * 404. Driver failures are not caught here: a caller that has a unique index or a
 * CHECK worth a status of its own catches around this.
 */
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

  // Only reachable for a row that went between the write and this read, which no test
  // can stage — `inject` serialises requests. 404 is what happened either way.
  return found === undefined ? { kind: 'not_found' as const } : { kind: 'ok' as const, row: found }
}
