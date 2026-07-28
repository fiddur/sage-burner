import { z } from 'zod'

import { dateTimeSchema, idSchema, optionalText, text } from './common.ts'

/**
 * The field list, unrefined — see `eventFields` for why this is exported
 * separately from the refined schema.
 */
export const sessionFields = z.object({
  id: idSchema,
  event_id: idSchema,
  title: text(200),
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
export const sessionSchema = sessionFields
  .refine((s) => (s.time_slot_start === null) === (s.time_slot_end === null), {
    message: 'a time slot needs both a start and an end, or neither',
    path: ['time_slot_end'],
  })
  .refine(
    (s) =>
      // Compare instants, not strings. `z.iso.datetime()` permits optional
      // fractional seconds, and '…T09:00:00.500Z' < '…T09:00:00Z' is true
      // lexicographically ('.' sorts before 'Z') — so a string comparison here
      // would accept a slot ending half a second before it starts.
      s.time_slot_start === null ||
      s.time_slot_end === null ||
      Date.parse(s.time_slot_start) < Date.parse(s.time_slot_end),
    {
      message: 'time_slot_end must be after time_slot_start',
      path: ['time_slot_end'],
    },
  )

export type Session = z.infer<typeof sessionSchema>

/**
 * The subset of a session that may appear in the public ICS feed.
 *
 * The feed needs no authentication, so this shape is the guard rail: it carries
 * no host identity, no contact details, no allergies and no payment state. If a
 * field is not here, it does not leave the building.
 */
export const publicSessionSchema = z.object({
  id: idSchema,
  title: text(200),
  description: z.string().max(20_000),
  time_slot_start: dateTimeSchema,
  time_slot_end: dateTimeSchema,
  location: optionalText(200),
})

export type PublicSession = z.infer<typeof publicSessionSchema>
