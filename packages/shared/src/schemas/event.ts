import { z } from 'zod'

import { dateSchema, dateTimeSchema, idSchema, slugSchema, nonEmptyText } from './common.ts'

/** Tolerates missing keys so `.partial()` and `.omit()` derivations still typecheck. */
type DateRange = { start_date?: string; end_date?: string }

const hasOrderedDates = ({ start_date, end_date }: DateRange) =>
  start_date === undefined || end_date === undefined || start_date <= end_date

/**
 * Re-applies the start/end ordering check to a schema derived from
 * `eventFields`.
 *
 * `.refine()` lives on the refined schema, not the object, so
 * `eventFields.omit(...)` comes back without it. Every create or update body
 * must therefore be wrapped in this — otherwise the read path validates the
 * range and the write path, which is the one that matters, does not.
 *
 * Comparing as strings is sound here: `z.iso.date()` is fixed-width
 * `YYYY-MM-DD` and rejects impossible calendar dates, so lexicographic order is
 * chronological order. Timestamps are a different story — see `session.ts`.
 */
export const withEventDateOrder = <T extends z.ZodType<DateRange>>(schema: T) =>
  schema.refine(hasOrderedDates, {
    message: 'end_date must not be before start_date',
    path: ['end_date'],
  })

/**
 * The field list, unrefined.
 *
 * Exported separately because a top-level `.refine()` produces a schema that
 * `.omit()`, `.pick()` and `.partial()` refuse to operate on. Derive create and
 * update bodies from this rather than re-declaring the shape — and wrap the
 * result in `withEventDateOrder` so the derived schema keeps the invariant.
 */
export const eventFields = z.object({
  id: idSchema,
  name: nonEmptyText(200),
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
 */
export const eventSchema = withEventDateOrder(eventFields)

export type Event = z.infer<typeof eventSchema>
