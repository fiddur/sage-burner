import { z } from 'zod'

import { paymentStatuses } from '../enums.ts'
import { dateSchema, idSchema, optionalText, nonEmptyText } from './common.ts'

/** Tolerates missing keys so `.partial()` and `.omit()` derivations still typecheck. */
type Stay = { arrival_date?: string | null; departure_date?: string | null }

const staysInOrder = ({ arrival_date, departure_date }: Stay) =>
  arrival_date == null || departure_date == null || arrival_date <= departure_date

/**
 * Re-applies the arrival/departure ordering check to a schema derived from
 * `memberFields`.
 *
 * Wrap every derived create/update body in this — see `withEventDateOrder` for
 * why deriving from the unrefined object otherwise drops the invariant. This
 * one matters especially: the member profile page is a write path members use
 * themselves.
 */
export const withMemberStayOrder = <T extends z.ZodType<Stay>>(schema: T) =>
  schema.refine(staysInOrder, {
    message: 'departure_date must not be before arrival_date',
    path: ['departure_date'],
  })

/**
 * The field list, unrefined — see `eventFields` for why this is exported
 * separately, and wrap derivations in `withMemberStayOrder`.
 */
export const memberFields = z.object({
  id: idSchema,
  event_id: idSchema,
  account_id: idSchema,
  name: nonEmptyText(200),
  contact: nonEmptyText(500),
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
export const memberSchema = withMemberStayOrder(memberFields)

export type Member = z.infer<typeof memberSchema>
