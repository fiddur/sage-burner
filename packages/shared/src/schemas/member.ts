import { z } from 'zod'

import { paymentStatuses } from '../enums.ts'
import { dateSchema, idSchema, optionalText, text } from './common.ts'

/**
 * The field list, unrefined — see `eventFields` for why this is exported
 * separately from the refined schema.
 */
export const memberFields = z.object({
  id: idSchema,
  event_id: idSchema,
  account_id: idSchema,
  name: text(200),
  contact: text(500),
  /** Free text — "gluten", "sensitive to red lentils". Never a fixed list. */
  allergies_notes: optionalText(2000),
  arrival_date: dateSchema.nullable(),
  departure_date: dateSchema.nullable(),
  /**
   * Free text rather than an enum: the options differ per event and per site
   * (tents, tiny house floor, caravans, ...), so organisers must be able to add
   * one without a deploy.
   */
  lodging: optionalText(200),
  /** Likewise free text — "Cooking", "Cleaning", "Either/both", or whatever's next. */
  shift_preference: optionalText(200),
  notes: optionalText(2000),
  /** Set by admins only. Members see their own status but cannot change it. */
  payment_status: z.enum(paymentStatuses),
  payment_date: dateSchema.nullable(),
  invite_token_id: idSchema,
})

/**
 * A person's participation in one specific burn.
 *
 * Scoped to `(event, account)` on purpose: the same human attending three burns
 * has three member rows, each with its own payment state, allergies and arrival
 * dates. Collapsing that into one "person" record is a deliberate v2 refactor.
 *
 * String comparison is sound for the date range: `z.iso.date()` is fixed-width
 * `YYYY-MM-DD`, so lexicographic order is chronological order.
 */
export const memberSchema = memberFields.refine(
  (m) => m.arrival_date === null || m.departure_date === null || m.arrival_date <= m.departure_date,
  {
    message: 'departure_date must not be before arrival_date',
    path: ['departure_date'],
  },
)

export type Member = z.infer<typeof memberSchema>
