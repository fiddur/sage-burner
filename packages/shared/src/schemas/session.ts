import { z } from 'zod'

import { placeColors } from '../enums.ts'
import { MAX_DESCRIPTION, MAX_OPTION_LABEL, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, optionalText, nonEmptyText } from './common.ts'

/** Tolerates missing keys so `.partial()` and `.omit()` derivations still typecheck. */
type TimeSlot = { time_slot_start?: string | null; time_slot_end?: string | null }

/**
 * Both ends or neither — but only when both keys are actually present.
 *
 * An absent key is not the same as a null one, and conflating them made every
 * single-ended PATCH a 400: `{ time_slot_end }` alone read as "end set, start
 * cleared" and was refused before the row could be consulted. A lone key is
 * decidable only against the stored row, which is what the PATCH handler in
 * `sessions.ts` uses `hasValidTimeSlot` for. Same reasoning as
 * `violatesTickBoxRules`.
 *
 * The create schema defaults both to null, so they are always present there and
 * this still refuses half a slot at creation.
 */
const hasWholeSlot = (slot: TimeSlot) => {
  if (!('time_slot_start' in slot) || !('time_slot_end' in slot)) return true

  return (slot.time_slot_start == null) === (slot.time_slot_end == null)
}

// Compares instants, not strings. `z.iso.datetime()` permits optional
// fractional seconds, and '…T09:00:00.500Z' < '…T09:00:00Z' is true
// lexicographically ('.' sorts before 'Z') — so a string comparison would
// accept a slot ending half a second before it starts.
const hasOrderedSlot = ({ time_slot_start, time_slot_end }: TimeSlot) =>
  time_slot_start == null || time_slot_end == null || Date.parse(time_slot_start) < Date.parse(time_slot_end)

/**
 * Whether a whole slot — both keys present — is valid.
 *
 * Exported so the PATCH handler can apply the same rule to the row merged with
 * the update, which is the only way to judge a body carrying one end. One rule
 * in one place rather than the same comparison written again in SQL, where
 * fractional seconds would make it wrong anyway.
 */
export const hasValidTimeSlot = (slot: TimeSlot) => hasWholeSlot(slot) && hasOrderedSlot(slot)

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
  title: nonEmptyText(MAX_TITLE),
  /** Who runs it, or null while nobody has said they will. The routes check they are coming. */
  facilitator_account_id: idSchema.nullable(),
  description: z.string().max(MAX_DESCRIPTION),
  /**
   * Whether placing it leaves it behind to place again.
   *
   * Nothing in the API treats it specially — the schedule page copies on drop.
   * Placing, moving and unplacing are all one PATCH, so a server that copied on
   * write would first have to decide which of those a given body is.
   */
  repeatable: z.boolean(),
  time_slot_start: dateTimeSchema.nullable(),
  time_slot_end: dateTimeSchema.nullable(),
  /**
   * Which lane the dream sits in, null while it is only offered.
   *
   * A reference rather than the free text this used to be: the scheduling grid
   * draws one column per place, and a column cannot be spelled three ways.
   */
  place_id: idSchema.nullable(),
})

/**
 * A "dream" — a member-offered workshop, ceremony or happening.
 *
 * An unscheduled dream (null time slot) is the normal state right up until the
 * burn, not an error: people offer things long before anyone decides when they
 * happen.
 *
 * The three added here are read-only and belong to no request body, which is why
 * the create and update schemas derive from `sessionFields` rather than from this.
 */
export const sessionSchema = withValidTimeSlot(
  sessionFields.extend({
    helpers: z.array(z.object({ account_id: idSchema, name: z.string().nullable() })),
    /**
     * Who has given it a ❤️‍🔥, by name (#251).
     *
     * Names rather than a bare count, so the grid can show whose faces they are.
     * The count used to be all there was, and the reason it could be is that a
     * heart said nothing about who — the page now says it, so the shape has to.
     * Members only, like every other name here: the ICS feed's projection is a
     * separate schema and does not have this.
     */
    supporters: z.array(
      z.object({ account_id: idSchema, name: z.string().nullable(), avatar: z.string().nullable() }),
    ),
    support_count: z.int().min(0),
    /** The reader's own answer, so one dream reads differently to two people. */
    supported_by_me: z.boolean(),
    /**
     * The conversation about it (#375), for the panel to read and write.
     *
     * Nullable because the read is a left join, not because a dream is expected to lack
     * one: it is written in the same transaction as the dream and the migration
     * backfilled the rest. An inner join would make a missing thread hide the dream
     * itself from the grid, which is a far worse failure than a panel with no comment
     * box — and the next write to the dream makes one anyway.
     */
    thread_id: idSchema.nullable(),
  }),
)

export type Session = z.infer<typeof sessionSchema>

/**
 * The subset of a session that may appear in the public ICS feed.
 *
 * The feed needs no authentication, so this shape is the guard rail: it carries no
 * facilitator, no contact details, no allergies and no payment state. If a field is
 * not here, it does not leave the building.
 *
 * Both timestamps are required — only scheduled sessions belong in a calendar —
 * and the ordering check is re-applied so the feed cannot emit an event whose
 * `DTEND` precedes its `DTSTART`.
 */
export const publicSessionFields = sessionFields.pick({ id: true, title: true, description: true }).extend({
  // Narrowed from nullable: only scheduled sessions belong in a calendar.
  time_slot_start: dateTimeSchema,
  time_slot_end: dateTimeSchema,
  // Resolved from the place rather than carried as an id — a calendar client
  // has nothing to do with a UUID. A projection, not a `pick`, which is why
  // these two are spelled out instead of derived.
  location: optionalText(MAX_OPTION_LABEL),
  color: z.enum(placeColors).nullable(),
})

export const publicSessionSchema = withValidTimeSlot(publicSessionFields)

export type PublicSession = z.infer<typeof publicSessionSchema>

export const sessionsResponseSchema = z.object({ sessions: z.array(sessionSchema) })
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>

export const sessionResponseSchema = z.object({ session: sessionSchema })
export type SessionResponse = z.infer<typeof sessionResponseSchema>

/**
 * Offering a dream.
 *
 * `event_id` comes from the route, so it is not accepted here — a body naming one
 * would let a member offer a dream against a burn they are not looking at.
 */
export const sessionCreateSchema = withValidTimeSlot(
  sessionFields
    .omit({ id: true, event_id: true })
    .extend({
      description: sessionFields.shape.description.default(''),
      time_slot_start: sessionFields.shape.time_slot_start.default(null),
      time_slot_end: sessionFields.shape.time_slot_end.default(null),
      place_id: sessionFields.shape.place_id.default(null),
      facilitator_account_id: sessionFields.shape.facilitator_account_id.default(null),
      repeatable: sessionFields.shape.repeatable.default(false),
    })
    .strict(),
)
export type SessionCreate = z.infer<typeof sessionCreateSchema>

/**
 * `SessionCreate` is the output type, so the defaulted fields are required
 * there — which makes the defaults useless to a caller typed against it. This is
 * the request shape. Same split as `EventCreateInput`.
 */
export type SessionCreateInput = z.input<typeof sessionCreateSchema>

/** Editing one, including scheduling it and handing it to a facilitator. */
export const sessionUpdateSchema = withValidTimeSlot(
  sessionFields.omit({ id: true, event_id: true }).partial().strict(),
)
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>
