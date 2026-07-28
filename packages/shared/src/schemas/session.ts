import { z } from 'zod'

import { dateTimeSchema, idSchema, optionalText, nonEmptyText } from './common.ts'

/** Tolerates missing keys so `.partial()` and `.omit()` derivations still typecheck. */
type TimeSlot = { time_slot_start?: string | null; time_slot_end?: string | null }

const hasWholeSlot = ({ time_slot_start, time_slot_end }: TimeSlot) =>
  (time_slot_start == null) === (time_slot_end == null)

// Compares instants, not strings. `z.iso.datetime()` permits optional
// fractional seconds, and '…T09:00:00.500Z' < '…T09:00:00Z' is true
// lexicographically ('.' sorts before 'Z') — so a string comparison would
// accept a slot ending half a second before it starts.
const hasOrderedSlot = ({ time_slot_start, time_slot_end }: TimeSlot) =>
  time_slot_start == null || time_slot_end == null || Date.parse(time_slot_start) < Date.parse(time_slot_end)

/**
 * Re-applies the time slot checks to a schema derived from `sessionFields`.
 *
 * Wrap every derived create/update body in this — see `withEventDateOrder` for
 * why deriving from the unrefined object otherwise drops the invariant.
 */
export const withValidTimeSlot = <T extends z.ZodType<TimeSlot>>(schema: T) =>
  schema
    .refine(hasWholeSlot, {
      message: 'a time slot needs both a start and an end, or neither',
      path: ['time_slot_end'],
    })
    .refine(hasOrderedSlot, {
      message: 'time_slot_end must be after time_slot_start',
      path: ['time_slot_end'],
    })

/**
 * The field list, unrefined — see `eventFields` for why this is exported
 * separately, and wrap derivations in `withValidTimeSlot`.
 *
 * Note that `z.iso.datetime()` accepts only `Z`-suffixed UTC, not numeric
 * offsets like `+02:00`. Times are stored and transported as UTC; converting to
 * Europe/Stockholm is the presentation layer's job, including in the ICS feed.
 */
export const sessionFields = z.object({
  id: idSchema,
  event_id: idSchema,
  title: nonEmptyText(200),
  host_member_id: idSchema,
  description: z.string().max(20_000),
  time_slot_start: dateTimeSchema.nullable(),
  time_slot_end: dateTimeSchema.nullable(),
  /** Free text in v1 — "Temple", "Sauna", "Front lawn at pond". */
  location: optionalText(200),
})

/**
 * A "dream" — a member-offered workshop, ceremony or happening.
 *
 * An unscheduled dream (null time slot) is the normal state right up until the
 * burn, not an error: people offer things long before anyone decides when they
 * happen.
 */
export const sessionSchema = withValidTimeSlot(sessionFields)

export type Session = z.infer<typeof sessionSchema>

/**
 * The subset of a session that may appear in the public ICS feed.
 *
 * The feed needs no authentication, so this shape is the guard rail: it carries
 * no host identity, no contact details, no allergies and no payment state. If a
 * field is not here, it does not leave the building.
 *
 * Both timestamps are required — only scheduled sessions belong in a calendar —
 * and the ordering check is re-applied so the feed cannot emit an event whose
 * `DTEND` precedes its `DTSTART`.
 */
export const publicSessionFields = sessionFields
  .pick({ id: true, title: true, description: true, location: true })
  .extend({
    // Narrowed from nullable: only scheduled sessions belong in a calendar.
    time_slot_start: dateTimeSchema,
    time_slot_end: dateTimeSchema,
  })

export const publicSessionSchema = withValidTimeSlot(publicSessionFields)

export type PublicSession = z.infer<typeof publicSessionSchema>
