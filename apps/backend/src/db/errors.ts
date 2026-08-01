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
