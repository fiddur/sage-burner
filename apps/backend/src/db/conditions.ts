import type { SQL } from 'drizzle-orm'

import { and } from 'drizzle-orm'

export const allOf = (first: SQL, ...rest: (SQL | undefined)[]): SQL => {
  const whole = and(first, ...rest)
  if (whole === undefined) throw new Error('refusing an unfiltered statement')

  return whole
}
