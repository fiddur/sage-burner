import { z } from 'zod'

import { dateSchema, dateTimeSchema, idSchema, slugSchema, text } from './common.ts'

/**
 * A single burn. There is always an `event` row — nothing in this system may
 * assume there is only one, since the whole point is that it recurs.
 */
export const eventSchema = z
  .object({
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
  .refine((event) => event.start_date <= event.end_date, {
    message: 'end_date must not be before start_date',
    path: ['end_date'],
  })

export type Event = z.infer<typeof eventSchema>
