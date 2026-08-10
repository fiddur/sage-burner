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

export const registerScheduleRoutes = (app: FastifyInstance, { db, now }: ScheduleDeps) => {
  app.get<{ Params: { token: string } }>(apiRoutes.scheduleFeed.fastify, async (request, reply) => {
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

    const events: CalendarEvent[] = rows.flatMap((row) => {
      const parsed = publicSessionSchema.safeParse({
        ...row,
        location: row.place_name === null ? null : `${row.place_emoji ?? ''} ${row.place_name}`.trim(),
      })

      return parsed.success ? [parsed.data] : []
    })

    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .send(renderCalendar({ name: found.name, events, now: now(), domain: 'sage-burner' }))
  })
}
