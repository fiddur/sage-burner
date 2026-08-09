import type { FastifyInstance } from 'fastify'

import { apiRoutes, publicSessionSchema } from '@sage-burner/shared'
import { asc, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { CalendarEvent } from '../ics.ts'

import { event, place, session } from '../db/schema.ts'
import { sendError } from '../http.ts'
import { renderCalendar } from '../ics.ts'

export interface ScheduleDeps {
  db: Database
  now: () => Date
}

/**
 * The programme as a calendar subscription.
 *
 * Unauthenticated, because a calendar client cannot hold a session — subscribing is a URL a
 * phone re-fetches on its own schedule. **Keyed by `event.feed_token`, not by the id** (#408):
 * the id is answered to the public homepage by `/api/events/active`, so keying on it left the
 * active burn's feed readable by any stranger who loaded the front page. The token is
 * unguessable, published nowhere, and rotatable; `docs/burns.md` still says not to hand it
 * outside the gathering, which is now advice rather than the only defence.
 *
 * The columns selected here are the whole of what leaves the building. No host,
 * no contact details, no allergies, no payment state — `schedule.test.ts` asserts
 * the rendered feed contains none of them, which is a test about the output
 * rather than about this query, so a future join cannot quietly widen it.
 */
export const registerScheduleRoutes = (app: FastifyInstance, { db, now }: ScheduleDeps) => {
  app.get<{ Params: { token: string } }>(apiRoutes.scheduleFeed.fastify, async (request, reply) => {
    // Public and re-fetched on a client's own schedule, so it may be cached —
    // but an edit has to show up, and there is no ETag here to revalidate
    // against. Same reasoning as `/api/events/active`.
    void reply.header('cache-control', 'no-cache')

    const [found] = await db
      .select({ id: event.id, name: event.name })
      .from(event)
      .where(eq(event.feed_token, request.params.token))
      .limit(1)

    if (found === undefined) return sendError(reply, 404)

    const rows = await db
      .select({
        id: session.id,
        title: session.title,
        description: session.description,
        time_slot_start: session.time_slot_start,
        time_slot_end: session.time_slot_end,
        place_name: place.name,
        place_emoji: place.emoji,
        color: place.color,
      })
      .from(session)
      .leftJoin(place, eq(session.place_id, place.id))
      .where(eq(session.event_id, found.id))
      .orderBy(asc(session.time_slot_start), asc(session.title))

    // Only what is actually scheduled — both ends, since a calendar entry needs
    // an end. This is also what narrows the nullable columns, so filtering in SQL
    // as well would be a second copy of the rule that no test could tell from
    // this one.
    // Parsed through `publicSessionSchema` rather than handed straight over. It
    // strips anything not in the public shape, so a column added to the select
    // above cannot reach the feed by being spread along with the rest — and
    // adding it to that schema instead fails `schemas.test.ts`, which pins the
    // key set. Without this the guard rail was written and never bolted on.
    const events: CalendarEvent[] = rows.flatMap((row) => {
      const parsed = publicSessionSchema.safeParse({
        ...row,
        location: row.place_name === null ? null : `${row.place_emoji ?? ''} ${row.place_name}`.trim(),
      })

      // Only what is actually scheduled: a dream with no slot fails the schema's
      // required timestamps, which is the same rule stated once rather than
      // filtered for here and asserted there.
      return parsed.success ? [parsed.data] : []
    })

    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .send(renderCalendar({ name: found.name, events, now: now(), domain: 'sage-burner' }))
  })
}
