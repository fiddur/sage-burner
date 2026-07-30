import { z } from 'zod'

import { dateSchema, dateTimeSchema, idSchema, slugSchema, nonEmptyText } from './common.ts'

/** Tolerates missing keys so `.partial()` and `.omit()` derivations still typecheck. */
type DateRange = { start_date?: string; end_date?: string }

const hasOrderedDates = ({ start_date, end_date }: DateRange) =>
  start_date === undefined || end_date === undefined || start_date <= end_date

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
    message: 'end_date must not be before start_date',
    path: ['end_date'],
  })

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
  name: nonEmptyText(200),
  slug: slugSchema,
  start_date: dateSchema,
  end_date: dateSchema,
  /** Rendered on the public homepage. Admin-authored, sanitized before display. */
  welcome_markdown: z.string().max(100_000),
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
    .extend({ welcome_markdown: eventFields.shape.welcome_markdown.default('') })
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
 * only rejects when both dates are present and out of order. A PATCH moving
 * *one* date past the other therefore passes here, so the handler has to catch
 * it — and it does so **inside the UPDATE**, not by re-reading first:
 * `PATCH /api/admin/events/:id` in `apps/backend/src/routes/events.ts` puts the
 * ordering condition in the statement's `where` and treats zero matched rows as
 * the 400. A read-then-check would leave a window where two organisers each
 * moving one date both validate against the pre-update row, and the second write
 * reaches `event_date_order_check` as a 500 — the outcome the check exists to
 * avoid. The both-dates case never reaches the handler at all: the refine below
 * rejects it, so `safeParse` answers 400 — which is why the handler carries no
 * check for it. Relaxing this refine would therefore not merely loosen
 * validation, it would let an out-of-order pair through to the database CHECK;
 * `rejects a patch with both dates in the wrong order` in `events.test.ts` is what
 * notices.
 */
export const eventUpdateSchema = withEventDateOrder(
  eventFields.omit({ id: true, created_at: true }).partial().strict(),
)
export type EventUpdate = z.infer<typeof eventUpdateSchema>

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
