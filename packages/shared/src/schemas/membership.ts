import { z } from 'zod'

import { paymentStatuses } from '../enums.ts'
import { MAX_CONTACT, MAX_NOTES, MAX_OPTION_LABEL, MAX_PERSON_NAME } from '../limits.ts'
import { emailSchema } from './auth.ts'
import { dateSchema, dateTimeSchema, idSchema, nonEmptyText, optionalText } from './common.ts'
import { eventFields } from './event.ts'

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
  name: nonEmptyText(MAX_PERSON_NAME),
  contact: nonEmptyText(MAX_CONTACT),
  /**
   * Free text — "sensitive to red lentils". The **Other** beside the ticks (#254):
   * a vocabulary is never complete, and the cost of it being wrong here is
   * somebody's dinner.
   */
  allergies_notes: optionalText(MAX_NOTES),
  /**
   * Which `allergy_item` rows they ticked.
   *
   * Ids rather than labels, so renaming an item does not rewrite what anybody said.
   * Stored as rows in `account_allergy`; a field here only on the way in and out —
   * the same shape `helping_option_ids` has on a stay.
   */
  allergy_item_ids: z.array(idSchema),
})

/**
 * What someone fills in when redeeming an invite.
 *
 * `.strict()` for the reason the event and question schemas give: an
 * unrecognised key is a 400 rather than a silent success.
 */
export const profileCreateSchema = profileFields
  .extend({
    // Defaulted so redeeming an invite is not blocked on a list the form may not
    // show yet. Nothing said is an empty set, not a missing answer.
    allergy_item_ids: profileFields.shape.allergy_item_ids.default([]),
  })
  .strict()

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
  helping_other: optionalText(MAX_OPTION_LABEL),
  notes: optionalText(MAX_NOTES),
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

/** Who an organiser is adding to a burn on someone else's behalf. */
export const attendanceCreateSchema = z.object({ account_id: idSchema }).strict()

/**
 * Whose hands — the body of every "put somebody on this" route.
 *
 * One schema for the dream's helpers, a meal's crew and a lead role's team,
 * because they are one gesture: 🙋 sends the caller's own id, the picker sends
 * somebody else's, and the route cannot tell them apart or want to.
 */
export const helperSchema = z.object({ account_id: idSchema }).strict()
export type Helper = z.infer<typeof helperSchema>

/** One burn on someone's own page, with their stay at it or nothing yet. */
export const myBurnSchema = z.object({
  /**
   * Enough of the burn for the pages the selector points at.
   *
   * The gate times are here because the schedule grid draws its rows from them; the
   * cap is not, because nothing outside the roster counts places. A summary is a
   * projection of the row, never a second opinion about it — `eventFields.pick`
   * rather than a hand-written shape, so a bound stated once cannot be restated
   * more loosely here.
   */
  event: eventFields.pick({
    id: true,
    name: true,
    slug: true,
    start_date: true,
    end_date: true,
    start_time: true,
    end_time: true,
  }),
  attendance: attendanceSchema.nullable(),
})

/**
 * Every burn someone's details page shows them.
 *
 * Two arrays rather than one with a flag, because the split is the server's to
 * make: "has this ended" is a comparison against *its* clock, and a browser
 * deciding it from `end_date` would answer differently either side of midnight
 * depending on the reader's timezone. `apps/web` pins `TZ` in its Vite config for
 * exactly the class of bug this avoids having at all.
 *
 * `coming` is every burn that has not ended — joined or not, since joining is what
 * the page is for. `past` is only the ones they actually came to; a burn somebody
 * never joined is not their history.
 */
export const myBurnsResponseSchema = z.object({
  /** Soonest first, so the one being planned is at the top. */
  coming: z.array(myBurnSchema),
  /** Most recent first. */
  past: z.array(myBurnSchema),
})

/**
 * Who is coming to a burn, by name, for the lists members fill in together.
 *
 * Names and ids only. The roster carries contact details, allergies and payment
 * state and stays admin's; this is the far narrower thing a member needs to hand
 * somebody a lead role — and a name is already visible to members on any dream
 * its host offered.
 */
export const eventAttendeesResponseSchema = z.object({
  attendees: z.array(
    z.object({
      account_id: idSchema,
      name: z.string().nullable(),
      /** When their picture last changed, or null for the initials. See `viewerSchema`. */
      avatar: z.string().nullable(),
    }),
  ),
})

export type AttendanceCreate = z.infer<typeof attendanceCreateSchema>
export type MyBurn = z.infer<typeof myBurnSchema>
export type MyBurnsResponse = z.infer<typeof myBurnsResponseSchema>
export type EventAttendeesResponse = z.infer<typeof eventAttendeesResponseSchema>

/**
 * One person on a burn's list, as an organiser sees them.
 *
 * The person-level fields are joined in from `account` rather than duplicated,
 * so an allergy corrected on the profile page is corrected here too.
 */
export const rosterEntrySchema = attendanceFields.extend({
  email: emailSchema,
  // From `profileFields`, so an allergy's bound is stated once. Nullable because
  // the join reaches an account that may not have filled these in yet.
  name: profileFields.shape.name.nullable(),
  contact: profileFields.shape.contact.nullable(),
  allergies_notes: profileFields.shape.allergies_notes,
  /**
   * The ticked items, as **labels** rather than ids (#254).
   *
   * Whoever cooks reads this, and a column of UUIDs is not something to cook from —
   * the same reason a stay's `helping` sits beside its `helping_option_ids`.
   */
  allergy_items: z.array(z.string()),
  /**
   * The lodging option's label, resolved at read time.
   *
   * A projection beside the id, not a second place to store it: the organiser
   * reading this wants "Temple mattress", and a CSV of UUIDs is no use to
   * anybody.
   */
  lodging: optionalText(MAX_OPTION_LABEL),
  /**
   * The ticked helping options' labels, resolved at read time and joined.
   *
   * A projection beside the ids, for the same reason `lodging` is one: an
   * organiser reading the roster or its CSV wants "Sauna, Kitchen", and a column
   * of UUIDs is no use to anybody.
   */
  helping: optionalText(MAX_NOTES),
  /** Derived from payment and join order every read — never stored. */
  waiting: z.boolean(),
})

export const rosterResponseSchema = z.object({
  event: eventFields.pick({ id: true, name: true, member_cap: true }).nullable(),
  entries: z.array(rosterEntrySchema),
})

/**
 * The same list as a member sees it (#159).
 *
 * Derived by subtraction from the organiser's entry so the two cannot drift into
 * describing different people. Two fields come off, and **`payment_status` is not
 * one of them**: having paid is the definite mark of somebody actually joining, and
 * it was a column everyone could read in the spreadsheet this replaces. What stays
 * admin's is *recording* it, which is the `PATCH` and not this read.
 *
 * - **`payment_date`** goes, because when a transfer landed is bookkeeping. The
 *   status answers "are they in"; the date answers a question only whoever
 *   reconciles the account is asking.
 * - **`email`** goes, being the login identity rather than a way of reaching
 *   somebody. `profileUpdateSchema` refuses to change it for that reason, and
 *   `contact` is the field a person fills in to be contacted. Nothing here falls
 *   back to it.
 */
export const memberRosterEntrySchema = rosterEntrySchema.omit({
  email: true,
  payment_date: true,
})

export const memberRosterResponseSchema = z.object({
  /**
   * Nullable for the client, not for the route.
   *
   * `GET /api/events/:eventId/members` answers 404 for a burn that is not there, so
   * the server never sends a null. The page reuses this shape for "no burn selected"
   * — which the selector decides, not the API — and that is the only thing the
   * nullability is for.
   */
  event: eventFields
    .pick({
      id: true,
      name: true,
      member_cap: true,
      payment_info_markdown: true,
      // What the page shows instead once the burn is full (#23) — both, so the
      // swap is the page's decision from data it already has rather than a second
      // request at the moment the burn fills.
      transfer_info_markdown: true,
    })
    .nullable(),
  entries: z.array(memberRosterEntrySchema),
})

/**
 * What an organiser may set on someone's attendance. The status, and nothing else.
 *
 * `payment_date` is derived from the status and the clock rather than taken from
 * the caller, the way `joined_at` already is. Accepting both let them disagree:
 * `{ payment_status: 'unpaid' }` alone left yesterday's date standing, and a date
 * alone recorded a payment that the status said had not happened. The README
 * stated the invariant as a property of the system when it was in fact a habit of
 * the single caller.
 *
 * Backdating a transfer that landed last week is a real thing an organiser wants,
 * and this deliberately does not do it. It wants a field of its own with the
 * status validated against it — not one the server silently overrides.
 */
export const paymentUpdateSchema = z
  .object({ payment_status: z.enum(paymentStatuses) })
  .partial()
  .strict()

/**
 * Handing a paid place to somebody who has not paid (#23).
 *
 * One field, and the giver is the session rather than the body: a route that took
 * both ends could be asked to move somebody else's place. `.strict()` so a
 * misspelled key is a 400 rather than a transfer to nobody.
 */
export const placeTransferSchema = z.object({ to_account_id: idSchema }).strict()

export type PlaceTransfer = z.infer<typeof placeTransferSchema>

export type RosterEntry = z.infer<typeof rosterEntrySchema>
export type RosterResponse = z.infer<typeof rosterResponseSchema>
export type MemberRosterEntry = z.infer<typeof memberRosterEntrySchema>
export type MemberRosterResponse = z.infer<typeof memberRosterResponseSchema>
export type PaymentUpdate = z.infer<typeof paymentUpdateSchema>
