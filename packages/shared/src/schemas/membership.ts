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

/**
 * A profile as it is read back.
 *
 * `name` and `contact` are nullable here but required by `profileCreateSchema`,
 * and the asymmetry is the table's: an account can exist before anyone fills them
 * in — the CLI bootstrap admin is created with an email and nothing else. So
 * "required to set" and "may not be there yet" are both true, and a reader that
 * assumed non-null would be wrong for exactly that account.
 */
export const profileSchema = profileFields.extend({
  account_id: idSchema,
  email: emailSchema,
  name: profileFields.shape.name.nullable(),
  contact: profileFields.shape.contact.nullable(),
})

export const profileResponseSchema = z.object({ profile: profileSchema })

/**
 * What a member may change about themselves.
 *
 * Partial, because the profile page and the stay form save separately and a
 * PATCH should name only what it changes. Not `email` — that is the login
 * identity, and changing it is a different act with its own verification, which
 * nothing implements yet.
 */
export const profileUpdateSchema = profileFields.partial().strict()

/** The field list, unrefined — see `eventFields` for why this is separate. */
export const attendanceFields = z.object({
  id: idSchema,
  event_id: idSchema,
  account_id: idSchema,
  joined_at: dateTimeSchema,
  arrival_date: dateSchema.nullable(),
  departure_date: dateSchema.nullable(),
  /**
   * Which `event_option` they picked to sleep in, or null for not said.
   *
   * A reference rather than the free text this used to be. The options still
   * differ per event and per site, and organisers still add one without a
   * deploy — they are rows now — but an id is what lets anyone count who is
   * sleeping where.
   */
  lodging_option_id: idSchema.nullable(),
  /**
   * Which helping-out options they ticked, as ids.
   *
   * A set, because people help with more than one thing, and references rather
   * than text so an organiser can count who is up for the kitchen. Stored as rows
   * in `attendance_helping`; a field here only on the way in and out.
   */
  helping_option_ids: z.array(idSchema),
  /**
   * Something to help with that the list does not have.
   *
   * Beside the ticks rather than instead of them. The point of the list is
   * counting; the point of this is that a list is never complete.
   */
  helping_other: optionalText(200),
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

/**
 * What a member may change about their own stay.
 *
 * `payment_status` and `payment_date` are omitted deliberately: they are the
 * organiser's to set, and a member who could write them could mark themselves
 * paid. `event_id` and `account_id` are omitted for the same reason in a
 * different direction — they identify whose row it is, and the route derives
 * both from the session rather than the body.
 *
 * Wrapped in `withStayOrder`, so a PATCH carrying both dates still cannot record
 * a departure before the arrival — see `withEventDateOrder` for why deriving
 * from the unrefined object would drop that.
 */
export const attendanceUpdateSchema = withStayOrder(
  attendanceFields
    .omit({
      id: true,
      event_id: true,
      account_id: true,
      joined_at: true,
      payment_status: true,
      payment_date: true,
    })
    .partial()
    .strict(),
)

export type Profile = z.infer<typeof profileSchema>
export type ProfileCreate = z.infer<typeof profileCreateSchema>
export type ProfileResponse = z.infer<typeof profileResponseSchema>
export type Attendance = z.infer<typeof attendanceSchema>
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>
export type AttendanceUpdate = z.infer<typeof attendanceUpdateSchema>

/**
 * Someone's attendance at the active burn, as they see it.
 *
 * `null` when they have not said they are coming — the page needs to tell "not
 * coming" from "coming and nothing filled in yet", and both are ordinary states.
 */
export const myAttendanceResponseSchema = z.object({
  event: z.object({ id: idSchema, name: nonEmptyText(200), slug: nonEmptyText(120) }).nullable(),
  attendance: attendanceSchema.nullable(),
})

/** Who an organiser is adding to a burn on someone else's behalf. */
export const attendanceCreateSchema = z.object({ account_id: idSchema }).strict()

export type MyAttendanceResponse = z.infer<typeof myAttendanceResponseSchema>
export type AttendanceCreate = z.infer<typeof attendanceCreateSchema>

/**
 * One person on a burn's list, as an organiser sees them.
 *
 * The person-level fields are joined in from `account` rather than duplicated,
 * so an allergy corrected on the profile page is corrected here too.
 */
export const rosterEntrySchema = attendanceFields.extend({
  email: emailSchema,
  name: nonEmptyText(200).nullable(),
  contact: nonEmptyText(500).nullable(),
  allergies_notes: optionalText(2000),
  /**
   * The lodging option's label, resolved at read time.
   *
   * A projection beside the id, not a second place to store it: the organiser
   * reading this wants "Temple mattress", and a CSV of UUIDs is no use to
   * anybody.
   */
  lodging: optionalText(200),
  /**
   * The ticked helping options' labels, resolved at read time and joined.
   *
   * A projection beside the ids, for the same reason `lodging` is one: an
   * organiser reading the roster or its CSV wants "Sauna, Kitchen", and a column
   * of UUIDs is no use to anybody.
   */
  helping: optionalText(2000),
  /** Derived from payment and join order every read — never stored. */
  waiting: z.boolean(),
})

export const rosterResponseSchema = z.object({
  event: z.object({ id: idSchema, name: nonEmptyText(200), member_cap: z.int().positive() }).nullable(),
  entries: z.array(rosterEntrySchema),
})

/** What an organiser may set on someone's attendance. Payment, and nothing else. */
export const paymentUpdateSchema = z
  .object({
    payment_status: z.enum(paymentStatuses),
    payment_date: dateSchema.nullable(),
  })
  .partial()
  .strict()

export type RosterEntry = z.infer<typeof rosterEntrySchema>
export type RosterResponse = z.infer<typeof rosterResponseSchema>
export type PaymentUpdate = z.infer<typeof paymentUpdateSchema>
