import { z } from 'zod'

import { rideKinds } from '../enums.ts'
import { MAX_NOTES, MAX_RIDE_PLACE } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'

/**
 * Getting to the burn and back, which the spreadsheet kept as a Rideshares tab (#26).
 *
 * One row per journey somebody has said something about, and `kind` is which half of
 * the board it is on: **needs** a ride, or **offers** one. One table rather than two,
 * because everything else about them is the same — where from, which day, how much
 * room — and two tables would be one schema written twice with a word changed.
 *
 * **Per burn.** People come from different places to different burns, and a lift
 * offered last summer is not an offer now.
 *
 * The contact is *not* here. It lives on the account, where the details page already
 * asks for it and the Members roster already shows it to every approved member — so
 * a copy in this row would be a phone number to keep in step, wrong in exactly the
 * moment somebody most needs it. The board resolves it at read time.
 */
export const rideSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  /** Whoever posted it. The board resolves their name and contact from the account. */
  account_id: idSchema,
  kind: z.enum(rideKinds),
  /** Where the journey starts — "Göteborg", "Copenhagen, by way of Malmö". */
  from: nonEmptyText(MAX_RIDE_PLACE),
  /**
   * Which day, as the member wrote it: "Friday afternoon", "the 1st, early".
   *
   * Text rather than a date. A lift is arranged around a time of day and a
   * willingness to wait, and a date picker would ask for precision nobody has three
   * weeks out — the arrival date on somebody's stay is the precise one.
   */
  when: nonEmptyText(MAX_RIDE_PLACE),
  /**
   * Seats going spare, for an offer. Zero on a request, where it would mean nothing.
   *
   * Not a capacity to book against: nothing claims a seat, because the board is two
   * lists and whoever wants one gets in touch. A count is what somebody reads to know
   * whether it is worth asking.
   */
  seats: z.int().nonnegative(),
  notes: z.string().max(MAX_NOTES),
  created_at: z.string(),
})

export type Ride = z.infer<typeof rideSchema>

/** A row as the board draws it: the journey, plus who to ask about it. */
export const rideEntrySchema = rideSchema.extend({
  name: z.string().nullable(),
  contact: z.string().nullable(),
})

export type RideEntry = z.infer<typeof rideEntrySchema>

export const ridesResponseSchema = z.object({ rides: z.array(rideEntrySchema) })
export type RidesResponse = z.infer<typeof ridesResponseSchema>

/**
 * `event_id` comes from the path and `account_id` from the session, so neither is
 * offered — a body naming either would be a second, disagreeing opinion about whose
 * journey this is and which burn it is to.
 */
export const rideCreateSchema = rideSchema
  .omit({ id: true, event_id: true, account_id: true, created_at: true })
  .strict()

export type RideCreate = z.infer<typeof rideCreateSchema>

export const rideUpdateSchema = rideCreateSchema.partial().strict()
export type RideUpdate = z.infer<typeof rideUpdateSchema>
