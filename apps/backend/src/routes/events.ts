import type { ActiveEventResponse, Event, EventResponse, EventsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  eventCreateSchema,
  eventUpdateSchema,
  eventWelcomeUpdateSchema,
  hasOrderedRange,
} from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isCheckViolation, isUniqueViolation } from '../db/errors.ts'
import { patchRow } from '../db/patch.ts'
import { event } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withVersion } from '../if-match.ts'
import { newFeedToken } from './calendar.ts'

export interface EventRouteDeps extends GuardDeps {
  now: () => Date
}

/**
 * Today as `YYYY-MM-DD`, UTC.
 *
 * UTC rather than a configured zone, deliberately: the only thing this decides
 * is when an event stops being the active one, and being a few hours out on the
 * day it ends changes nothing an admin would notice. A timezone setting
 * would be a configuration knob, a migration and a test matrix bought for that.
 */
export const todayIso = (now: () => Date) => now().toISOString().slice(0, 10)

/**
 * The active event: the soonest-ending event that has not ended yet.
 *
 * Stated as a rule rather than left implicit, because "the current event" is
 * the sort of thing that otherwise means something slightly different in each
 * place it is needed. Ties break on start date then slug so the answer is
 * deterministic when two events end the same day.
 *
 * **After the last event ends there is no active event, and the homepage says
 * so.** The alternative — falling back to the most recent past event — was
 * rejected: it leaves last year's welcome text on the public page indefinitely,
 * which reads as a live invitation to a burn that already happened. Creating
 * the next event is what fills the gap, and that is the action the admin
 * wants prompting toward anyway.
 */
/**
 * A burn as it leaves the building, named field by field.
 *
 * `asMemberEntry`'s property and `asMemberEntry`'s reason: a column added to `event` reaches
 * a response only when somebody names it here. `db.select()` put `feed_token` straight into
 * `GET /api/events/active` — unguarded, and fetched by the public homepage on every anonymous
 * visit — so the stranger who used to read the id off the front page read the token off it
 * instead (#408).
 *
 * `eventSchema` describes that shape and does not enforce it: no route here declares a
 * Fastify `response` schema and there is no serializer compiler, so a response is whatever
 * `JSON.stringify` makes of the row. A type is not a filter, which is the whole lesson.
 *
 * The `Event` return type is what makes it complete: dropping a field is a compile error, and
 * a column added to the table without being added to `Event` never reaches this at all —
 * `meal_intro_markdown` is one such, and `db.select()` had been answering it to the public
 * homepage as well, harmlessly and unnoticed.
 */
export const asEvent = (row: typeof event.$inferSelect): Event => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  start_date: row.start_date,
  end_date: row.end_date,
  start_time: row.start_time,
  end_time: row.end_time,
  location: row.location,
  welcome_markdown: row.welcome_markdown,
  payment_info_markdown: row.payment_info_markdown,
  transfer_info_markdown: row.transfer_info_markdown,
  member_cap: row.member_cap,
  created_at: row.created_at,
})

export const activeEvent = async (db: Database, today: string): Promise<Event | undefined> => {
  const [row] = await db
    .select()
    .from(event)
    .where(gte(event.end_date, today))
    .orderBy(asc(event.end_date), asc(event.start_date), asc(event.slug))
    .limit(1)

  return row === undefined ? undefined : asEvent(row)
}

/**
 * A burn by id, if it has not ended.
 *
 * The rule every member-facing write is scoped by, in one place: a finished burn is
 * the record of what happened, and an id noted while it was current should not still
 * be a way to change it. Wider than `activeEvent` on purpose — a burn months off is
 * open, which is how one gets set up and joined before it is the next one.
 */
export const openEvent = async (db: Database, today: string, eventId: string): Promise<Event | undefined> => {
  const [row] = await db
    .select()
    .from(event)
    .where(and(eq(event.id, eventId), gte(event.end_date, today)))
    .limit(1)

  return row === undefined ? undefined : asEvent(row)
}

/**
 * The two above with the clock composed in, which is how every caller wants them.
 *
 * `openEvent(db, todayIso(now), id)` was written out thirteen times and
 * `activeEvent(db, todayIso(now))` three more. The middle argument is the one nobody
 * varies — a route asking about a different day would be doing something nothing
 * here does — so it is the composition that belongs in one place rather than the
 * decision, which already was.
 */
export const openEventNow = (db: Database, now: () => Date, eventId: string): Promise<Event | undefined> =>
  openEvent(db, todayIso(now), eventId)

export const activeEventNow = (db: Database, now: () => Date): Promise<Event | undefined> =>
  activeEvent(db, todayIso(now))

/** Whether `error` is SQLite refusing a duplicate `slug`. */
const isSlugConflict = (error: unknown) => isUniqueViolation(error, 'event.slug')

export const registerEventRoutes = (app: FastifyInstance, { db, sessions, now }: EventRouteDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  /**
   * The burn as the homepage reads it, which is also what the welcome text's
   * `If-Match` is against (#274) — one shape, so a tag cannot describe the other one.
   */
  const asRead = (found: Event | null): ActiveEventResponse => ({ event: found })

  app.get(apiRoutes.getActiveEvent.fastify, async (_request, reply) => {
    // `no-cache`, not `no-store`. This is public content, so there is no reason
    // to forbid storing it — but #13 requires an edit to show up without a
    // redeploy, and with no `ETag` or `Last-Modified` the response would
    // otherwise be *heuristically* fresh and an admin's correction could sit
    // invisible in a browser cache. `no-cache` means "store it, but revalidate
    // before reuse", which is exactly the requirement.
    void reply.header('cache-control', 'no-cache')

    // Null rather than 404: having no event yet is the ordinary state of a
    // fresh deployment, not an error, and the homepage renders an explanation.
    return withVersion(reply, asRead((await activeEventNow(db, now)) ?? null))
  })

  app.get(apiRoutes.getEvents.fastify, async (_request, reply) => {
    void noStore(reply)

    const rows = await db.select().from(event).orderBy(asc(event.start_date))

    return { events: rows.map(asEvent) } satisfies EventsResponse
  })

  app.post(apiRoutes.createEvent.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(eventCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const row = { ...body, id: randomUUID(), created_at: now().toISOString() }

    try {
      await db.insert(event).values({ ...row, feed_token: newFeedToken() })
    } catch (error) {
      // The slug is in URLs, so a collision is a thing the admin can fix by
      // choosing another — worth its own status rather than a generic 400.
      if (isSlugConflict(error)) return sendError(reply, 409)
      throw error
    }

    return reply.code(201).send({ event: row } satisfies EventResponse)
  })

  /**
   * The welcome text, which any approved member may rewrite.
   *
   * Its own route rather than a carve-out in the admin PATCH below. That handler
   * writes the burn's shape — dates, times, cap, slug — and is under
   * `/api/admin/`, where the prefix hook guards it structurally with no per-route
   * opt-out. Opening one field of it would move that write out from under the
   * hook and turn its protection back into a line of code inside a branch, which
   * is the thing #64 removed. Ten duplicated lines are the cheaper half of that
   * trade.
   */
  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateWelcome.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(eventWelcomeUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      // Scoped like every other member-facing write keyed by a bare id (#218). Without
      // it any approved member could rewrite a finished burn's welcome text
      // indefinitely — the one route in this family that took an id and never looked
      // at `end_date`.
      const open = await openEventNow(db, now, request.params.id)
      if (open === undefined) return sendError(reply, 404)

      // Against `{ event }`, the shape `getActiveEvent` answers with — the page that
      // writes this is the homepage, which read the burn from there. Editing a burn
      // that is not the active one therefore cannot match, and is refused rather than
      // allowed to overwrite blind.
      if (await refuseIfStale(request, reply, async () => asRead(open))) return reply

      const [updated] = await db.update(event).set(body).where(eq(event.id, request.params.id)).returning()

      return updated === undefined
        ? sendError(reply, 404)
        : ({ event: asEvent(updated) } satisfies EventResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(apiRoutes.updateEvent.fastify, async (request, reply) => {
    void noStore(reply)

    const { id } = request.params
    const body = bodyOf(eventUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    // The rule applied to the row as it would be, because a body carrying one
    // date — or only a time — cannot be judged on its own. A multi-day burn may
    // run 22:00 to 10:00; narrowing it to a single day makes that pair invalid,
    // and nothing in the body says so.
    //
    // This replaced a condition composed into the WHERE. That handled one date
    // against the stored other, but had no way to see the times, so those two
    // patches reached the database and came back as a 500 from
    // `event_date_order_check`.
    //
    // Unconditional, and it costs nothing: the no-op body `patchRow` answers with a
    // read of its own is the only one that did not already need this.
    const [before] = await db.select().from(event).where(eq(event.id, id)).limit(1)
    if (before === undefined) return sendError(reply, 404)

    if (!hasOrderedRange({ ...before, ...body })) {
      return sendError(reply, 400)
    }

    // Caught around `patchRow` rather than inside it: a unique index and a CHECK are
    // this route's own, and each has a status of its own to answer with.
    const patched = await patchRow(db, event, eq(event.id, id), body).catch((error: unknown) => {
      if (isSlugConflict(error)) return 'conflict' as const
      // Only reachable when two patches merged against the same pre-write
      // row into a combination neither sent. Answered rather than thrown:
      // the caller can retry, and a 500 tells them nothing.
      if (isCheckViolation(error, 'event_date_order_check')) return 'unordered' as const
      throw error
    })

    if (patched === 'conflict') return sendError(reply, 409)
    if (patched === 'unordered') return sendError(reply, 400)

    // No condition was passed, so nothing but `ok` can mean anything other than
    // "the row went between the read above and the write" — which `inject`
    // serialises requests too tightly to reach, and 404 is what happened.
    if (patched.kind !== 'ok') return sendError(reply, 404)

    return { event: asEvent(patched.row) } satisfies EventResponse
  })
}
