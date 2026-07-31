import { z } from 'zod'

import { paymentStatuses } from '../enums.ts'
import { emailSchema } from './auth.ts'
import { dateSchema, dateTimeSchema, idSchema, nonEmptyText, optionalText } from './common.ts'

/** Tolerates missing keys so `.partial()` and `.omit()` derivations still typecheck. */
type Stay = { arrival_date?: string | null; departure_date?: string | null }

const staysInOrder = ({ arrival_date, departure_date }: Stay) =>
  arrival_date == null || departure_date == null || arrival_date <= departure_date

/**
 * Re-applies the arrival/departure ordering check to a schema derived from
 * `attendanceFields` — see `withEventDateOrder` for why deriving from the
 * unrefined object otherwise drops the invariant.
 */
export const withStayOrder = <T extends z.ZodType<Stay>>(schema: T) =>
  schema.refine(staysInOrder, {
    message: 'departure_date must not be before arrival_date',
    path: ['departure_date'],
  })

/**
 * The person-level details, which live on the `account` rather than per burn.
 *
 * Held per burn they meant a copy for every burn someone came to, and correcting
 * one left the others wrong — on data that exists to keep people safe. One human,
 * one account, one set of details.
 */
export const profileFields = z.object({
  name: nonEmptyText(200),
  contact: nonEmptyText(500),
  /** Free text — "gluten", "sensitive to red lentils". Never a fixed list. */
  allergies_notes: optionalText(2000),
})

/**
 * What someone fills in when redeeming an invite.
 *
 * `.strict()` for the reason the event and question schemas give: an
 * unrecognised key is a 400 rather than a silent success.
 */
export const profileCreateSchema = profileFields.strict()

export const profileSchema = profileFields.extend({
  account_id: idSchema,
  email: emailSchema,
})

export const profileResponseSchema = z.object({ profile: profileSchema })

/** The field list, unrefined — see `eventFields` for why this is separate. */
export const attendanceFields = z.object({
  id: idSchema,
  event_id: idSchema,
  account_id: idSchema,
  joined_at: dateTimeSchema,
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
})

/**
 * One person's participation in one burn.
 *
 * The same human attending three burns has one profile and three attendances,
 * each with its own payment state and dates.
 *
 * String comparison is sound for the range: `z.iso.date()` is fixed-width
 * `YYYY-MM-DD`, so lexicographic order is chronological order.
 */
export const attendanceSchema = withStayOrder(attendanceFields)

export type Profile = z.infer<typeof profileSchema>
export type ProfileCreate = z.infer<typeof profileCreateSchema>
export type ProfileResponse = z.infer<typeof profileResponseSchema>
export type Attendance = z.infer<typeof attendanceSchema>
