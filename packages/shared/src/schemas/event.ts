import { z } from 'zod'

import { dateSchema, dateTimeSchema, idSchema, slugSchema, text } from './common.ts'

/**
 * The field list, unrefined.
 *
 * Exported separately because a top-level `.refine()` produces a schema that
 * `.omit()`, `.pick()` and `.partial()` refuse to operate on — so create and
 * update bodies derive from this, rather than re-declaring the shape and
 * duplicating a schema.
 */
export const eventFields = z.object({
  id: idSchema,
  name: text(200),
  slug: slugSchema,
  start_date: dateSchema,
  end_date: dateSchema,
  /** Rendered on the public homepage. Admin-authored, sanitized before display. */
  welcome_markdown: z.string().max(100_000),
  /** Membership cap, e.g. 42. Approvals past this go to the waiting list. */
  member_cap: z.int().positive(),
  created_at: dateTimeSchema,
})

/**
 * A single burn. There is always an `event` row — nothing in this system may
 * assume there is only one, since the whole point is that it recurs.
 *
 * Comparing the dates as strings is sound here, and only here: `z.iso.date()`
 * is fixed-width `YYYY-MM-DD`, so lexicographic order is chronological order.
 * Timestamps are a different story — see `sessionSchema`.
 */
export const eventSchema = eventFields.refine((event) => event.start_date <= event.end_date, {
  message: 'end_date must not be before start_date',
  path: ['end_date'],
})

export type Event = z.infer<typeof eventSchema>
