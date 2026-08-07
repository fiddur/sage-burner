/**
 * Composing a `WHERE` that the type system agrees is one.
 */

import type { SQL } from 'drizzle-orm'

import { and } from 'drizzle-orm'

/**
 * `and(...)`, typed as the `SQL` it always is.
 *
 * Drizzle types `and` as `SQL | undefined` however many conditions it is handed,
 * because the array it takes may be empty or entirely undefined. Two routes compose a
 * `WHERE` this way and give it to an `UPDATE` or a `DELETE`, where the difference is
 * not academic: `undefined` there is an unfiltered write over the whole table.
 *
 * Requiring one definite condition makes the union unreachable rather than checked at
 * every call site — the throw is there because a type cannot be narrowed by argument
 * count, not because anything can reach it.
 */
export const allOf = (first: SQL, ...rest: (SQL | undefined)[]): SQL => {
  const whole = and(first, ...rest)
  if (whole === undefined) throw new Error('refusing an unfiltered statement')

  return whole
}
