/**
 * Telling one SQLite constraint failure from another.
 *
 * These are string matches on a driver's message, which is as fragile as it
 * looks — so each one lives here once rather than being written out wherever it
 * is caught. Three copies of the foreign key check had already appeared before
 * this file existed, and a fourth spelling would have been a silent 500.
 *
 * Each is pinned by a test that provokes the real violation, so a driver
 * changing its wording fails the suite rather than turning a 404 into a 500.
 */

/**
 * A write naming a row that is not there, or a delete of one still referenced.
 *
 * Both directions of the same constraint, and which one it is depends entirely
 * on the statement that raised it — SQLite does not distinguish them. The caller
 * knows: an insert naming a bad `place_id` is a 400, a delete of a place still
 * in use is a 409.
 */
export const isForeignKeyViolation = (failure: unknown): boolean =>
  failure instanceof Error && /FOREIGN KEY constraint failed/i.test(failure.message)

/**
 * SQLite refusing a duplicate, on a UNIQUE column or a unique index.
 *
 * The narrowing is the point. A `catch` that answers 409 to everything tells a caller
 * "there is already one of those" when the disk filled up.
 *
 * `column` narrows it further, to `table.column` as the message spells it — which is
 * what a route wants when the table it wrote to has more than one unique constraint
 * and only one of them means what its 409 says. Left out, any duplicate matches; the
 * message names columns rather than the index, so that is as far as this can go
 * without being told which.
 *
 * Three routes had a regex of their own for exactly this, one of them with a doc
 * comment saying it mirrored another — which is what the file's own opening
 * paragraph exists to prevent.
 */
export const isUniqueViolation = (failure: unknown, column?: string): boolean => {
  if (!(failure instanceof Error)) return false
  if (!/UNIQUE constraint failed/i.test(failure.message)) return false

  return column === undefined || failure.message.includes(column)
}

/**
 * SQLite refusing a named CHECK.
 *
 * The handler validates before writing, so this only fires for a combination no
 * single request sent — two patches merged against the same pre-write row. Not
 * defended against beyond this, at forty-odd people and four burns a year, but
 * the difference between a 400 and a 500 is the difference between "that did not
 * work, try again" and a stack trace.
 */
export const isCheckViolation = (failure: unknown, name: string): boolean =>
  failure instanceof Error && failure.message.includes(`CHECK constraint failed: ${name}`)
