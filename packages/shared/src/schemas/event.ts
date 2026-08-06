import { z } from 'zod'

import { MAX_TITLE, MAX_WELCOME_LENGTH } from '../limits.ts'
import { dateSchema, dateTimeSchema, idSchema, slugSchema, nonEmptyText, timeSchema } from './common.ts'

/** Tolerates missing keys so `.partial()` and `.omit()` derivations still typecheck. */
type DateRange = { start_date?: string; end_date?: string; start_time?: string; end_time?: string }

/**
 * The burn must not end before it starts — compared as a day *and* a time, since
 * a one-day burn can now be 10:00 to 22:00 or, wrongly, 22:00 to 10:00.
 *
 * The times only decide it when the days are equal. On different days the day
 * comparison already answers, and an end time earlier in the clock than the start
 * is ordinary for any burn spanning midnight.
 */
const hasOrderedDates = ({ start_date, end_date, start_time, end_time }: DateRange) => {
  if (start_date === undefined || end_date === undefined) return true
  if (start_date !== end_date) return start_date < end_date
  if (start_time === undefined || end_time === undefined) return true

  return start_time <= end_time
}

/**
 * Re-applies the start/end ordering check to a schema derived from
 * `eventFields`.
 *
 * `.refine()` lives on the refined schema, not the object, so
 * `eventFields.omit(...)` comes back without it. Every create or update body
 * must therefore be wrapped in this — otherwise the read path validates the
 * range and the write path, which is the one that matters, does not.
 *
 * Comparing as strings is sound here: `z.iso.date()` is fixed-width
 * `YYYY-MM-DD` and rejects impossible calendar dates, so lexicographic order is
 * chronological order. Timestamps are a different story — see `session.ts`.
 */
export const withEventDateOrder = <T extends z.ZodType<DateRange>>(schema: T) =>
  schema.refine(hasOrderedDates, {
    message: 'the burn must not end before it starts',
    path: ['end_date'],
  })

/**
 * Whether a whole event — every one of the four fields present — is ordered.
 *
 * Exported so the PATCH handler can apply it to the row merged with the update.
 * A body carrying one date, or only a time, can only be judged against what is
 * stored, and this is the same rule rather than a second copy of it in SQL.
 */
export const hasOrderedRange = (range: Required<DateRange>) => hasOrderedDates(range)

/**
 * The field list, unrefined.
 *
 * Exported separately because a top-level `.refine()` produces a schema that
 * `.omit()`, `.pick()` and `.partial()` refuse to operate on. Derive create and
 * update bodies from this rather than re-declaring the shape — and wrap the
 * result in `withEventDateOrder` so the derived schema keeps the invariant.
 */
export const eventFields = z.object({
  id: idSchema,
  name: nonEmptyText(MAX_TITLE),
  slug: slugSchema,
  start_date: dateSchema,
  end_date: dateSchema,
  /** When the gates open and close, local time. The schedule grid runs between. */
  start_time: timeSchema,
  end_time: timeSchema,
  /**
   * Rendered on the public homepage, written by any approved member, sanitized
   * before display. `MAX_WELCOME_LENGTH` is the limit the form shares.
   */
  welcome_markdown: z.string().max(MAX_WELCOME_LENGTH),
  /**
   * How to pay for this burn, written by an organiser and shown on the Members
   * page to whoever has not paid yet (#250).
   *
   * Per burn rather than per installation: the amount, the account and the
   * deadline are facts about one gathering, and last summer's are wrong for the
   * next one. Markdown, like every longer field somebody else reads.
   */
  payment_info_markdown: z.string().max(MAX_WELCOME_LENGTH),
  /** Membership cap, e.g. 42. Approvals past this go to the waiting list. */
  member_cap: z.int().positive(),
  created_at: dateTimeSchema,
})

/**
 * A single burn. There is always an `event` row — nothing in this system may
 * assume there is only one, since the whole point is that it recurs.
 */
export const eventSchema = withEventDateOrder(eventFields)

export type Event = z.infer<typeof eventSchema>

/**
 * Creating an event. `id` and `created_at` are the server's to assign.
 *
 * `welcome_markdown` defaults to empty so the create form is short: an
 * organiser naming a date and a cap should not also have to write the welcome
 * text before the event can exist.
 */
export const eventCreateSchema = withEventDateOrder(
  eventFields
    .omit({ id: true, created_at: true })
    .extend({
      welcome_markdown: eventFields.shape.welcome_markdown.default(''),
      payment_info_markdown: eventFields.shape.payment_info_markdown.default(''),
      // Defaulted so an organiser naming dates and a cap is not stopped by two
      // fields they may not have decided yet. The whole day, which is what the
      // grid did before the hours existed.
      start_time: eventFields.shape.start_time.default('00:00'),
      end_time: eventFields.shape.end_time.default('23:59'),
    })
    // `.strict()` for the same reason as the update schema, and so the two do not
    // differ for no stated reason: a stripped `welcome` for `welcome_markdown`
    // would otherwise 201 an event whose welcome text is silently the `.default('')`
    // rather than what was typed.
    .strict(),
)
export type EventCreate = z.infer<typeof eventCreateSchema>

/**
 * What a *client* may send, as opposed to what the parsed result contains.
 *
 * `EventCreate` is the output type, so `welcome_markdown` is required there
 * despite the `.default('')` — which makes the default useless to a caller
 * typed against it. This is the request shape.
 */
export type EventCreateInput = z.input<typeof eventCreateSchema>

/**
 * Editing one. Every field optional — the welcome text is edited far more often
 * than the dates, and a PATCH that had to restate the whole event would make
 * two organisers editing different fields overwrite each other.
 *
 * `.strict()` narrows the contract as well as catching typos: a client that
 * reads an event, edits the object and PATCHes the whole thing back now gets a
 * 400 on `id` and `created_at`. That is intended — a PATCH body should name what
 * it changes — and no client does it today, but it is a request-shape change and
 * not only a typo guard.
 *
 * So an unrecognised key is a 400 rather than a silent success. A
 * partial schema strips unknown keys, so `{"welcome": "…"}` — a plausible typo
 * for `welcome_markdown` — parsed to `{}` and the handler answered 200 with the
 * row unchanged, which the editor rendered as "Saved." while nothing had been
 * written. `{}` itself stays a legitimate no-op.
 *
 * Still wrapped in `withEventDateOrder`, which tolerates a partial range: it
 * only rejects when every field it needs is present and they are out of order. A
 * PATCH moving *one* date past the other, or carrying only a time, therefore
 * passes here — so `PATCH /api/admin/events/:id` in
 * `apps/backend/src/routes/events.ts` reads the row, merges the patch onto it and
 * applies `hasOrderedRange` to the result.
 *
 * That used to be a condition composed into the statement's `where`, which
 * decided it at write time. The times ended that: a multi-day burn may run 22:00
 * to 10:00, and narrowing it to one day makes the pair invalid without the body
 * containing either time — nothing a `WHERE` on the supplied dates can see. Both
 * such patches reached `event_date_order_check` and came back as a 500.
 *
 * The honest cost of the merged-row check is that two organisers patching at the
 * same moment can each validate against the same pre-update row and produce a
 * combination neither sent. The CHECK still refuses it, and the handler answers
 * 400 rather than 500 — see `isCheckViolation`. Not defended further: this is
 * forty-odd people and four burns a year.
 *
 * The both-dates case never reaches the handler at all: the refine below rejects
 * it, so `safeParse` answers 400. Relaxing this refine would therefore not merely
 * loosen validation, it would let an out-of-order pair through to the database
 * CHECK; `rejects a patch with both dates in the wrong order` in `events.test.ts`
 * is what notices.
 */
export const eventUpdateSchema = withEventDateOrder(
  eventFields.omit({ id: true, created_at: true }).partial().strict(),
)
export type EventUpdate = z.infer<typeof eventUpdateSchema>

/**
 * The one field of a burn any approved member may write.
 *
 * A route of its own rather than a carve-out inside `eventUpdateSchema`. The
 * burn's shape — its dates, times and cap — stays admin-only, and `.strict()`
 * here is what makes an attempt to smuggle `member_cap` through the member route
 * a 400 rather than a dropped key. Field-level checks inside the partial handler
 * would put that rule in a branch a later field could fall the wrong side of.
 */
export const eventWelcomeUpdateSchema = eventFields.pick({ welcome_markdown: true }).strict()
export type EventWelcomeUpdate = z.infer<typeof eventWelcomeUpdateSchema>

export const eventResponseSchema = z.object({ event: eventFields })
export type EventResponse = z.infer<typeof eventResponseSchema>

export const eventsResponseSchema = z.object({ events: z.array(eventFields) })
export type EventsResponse = z.infer<typeof eventsResponseSchema>

/**
 * The public homepage's event, or `null` before the first one is created.
 *
 * Nullable rather than 404: "no event yet" is the state a fresh deployment is
 * in, and the homepage should render an explanation rather than an error.
 */
export const activeEventResponseSchema = z.object({ event: eventFields.nullable() })
export type ActiveEventResponse = z.infer<typeof activeEventResponseSchema>
