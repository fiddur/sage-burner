import type { FastifyInstance } from 'fastify'

import { errorResponse } from '@sage-burner/shared'
import { asc, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { CalendarEvent } from '../ics.ts'

import { event, place, session } from '../db/schema.ts'
import { renderCalendar } from '../ics.ts'

export interface ScheduleDeps {
  db: Database
  now?: () => Date
}

/**
 * The programme as a calendar subscription.
 *
 * Unauthenticated, because a calendar client cannot hold a session — subscribing
 * is a URL a phone re-fetches on its own schedule. The event id is a UUID, so the
 * URL is unguessable; it is not a secret beyond that, and the README says plainly
 * that it should not be handed outside the gathering.
 *
 * The columns selected here are the whole of what leaves the building. No host,
 * no contact details, no allergies, no payment state — `schedule.test.ts` asserts
 * the rendered feed contains none of them, which is a test about the output
 * rather than about this query, so a future join cannot quietly widen it.
 */
export const registerScheduleRoutes = (
  app: FastifyInstance,
  { db, now = () => new Date() }: ScheduleDeps,
) => {
  app.get<{ Params: { eventId: string } }>('/events/:eventId/schedule.ics', async (request, reply) => {
    // Public and re-fetched on a client's own schedule, so it may be cached —
    // but an edit has to show up, and there is no ETag here to revalidate
    // against. Same reasoning as `/api/events/active`.
    void reply.header('cache-control', 'no-cache')

    const [found] = await db
      .select({ id: event.id, name: event.name })
      .from(event)
      .where(eq(event.id, request.params.eventId))
      .limit(1)

    if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

    const rows = await db
      .select({
        id: session.id,
        title: session.title,
        description: session.description,
        starts_at: session.time_slot_start,
        ends_at: session.time_slot_end,
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
    const events: CalendarEvent[] = rows.flatMap((row) =>
      row.starts_at === null || row.ends_at === null
        ? []
        : [
            {
              id: row.id,
              title: row.title,
              description: row.description,
              starts_at: row.starts_at,
              ends_at: row.ends_at,
              location: row.place_name === null ? null : `${row.place_emoji ?? ''} ${row.place_name}`.trim(),
              color: row.color,
            },
          ],
    )

    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .send(renderCalendar({ name: found.name, events, now: now(), domain: 'sage-burner' }))
  })
}
