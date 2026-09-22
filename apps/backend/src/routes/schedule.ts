import type { FastifyInstance } from 'fastify'

import { apiRoutes, meetingEnds, publicMeetingSchema, publicSessionSchema } from '@sage-burner/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { CalendarEvent } from '../ics.ts'

import { event, meeting, place, session } from '../db/schema.ts'
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
      .where(and(eq(session.event_id, found.id), isNull(session.withdrawn_at)))
      .orderBy(asc(session.time_slot_start), asc(session.title))

    const events: CalendarEvent[] = rows.flatMap((row) => {
      const parsed = publicSessionSchema.safeParse({
        ...row,
        location: row.place_name === null ? null : `${row.place_emoji ?? ''} ${row.place_name}`.trim(),
      })

      return parsed.success ? [parsed.data] : []
    })

    const meetings = await db
      .select({
        id: meeting.id,
        title: meeting.title,
        link: meeting.link,
        starts_at: meeting.starts_at,
        ends_at: meeting.ends_at,
      })
      .from(meeting)
      .where(eq(meeting.event_id, found.id))
      .orderBy(asc(meeting.starts_at), asc(meeting.id))

    const diary: CalendarEvent[] = meetings.flatMap((row) => {
      const parsed = publicMeetingSchema.safeParse({
        ...row,
        ends_at: meetingEnds(row.starts_at, row.ends_at),
      })

      if (!parsed.success) return []

      return [
        {
          id: parsed.data.id,
          title: parsed.data.title,
          description: parsed.data.link ?? '',
          time_slot_start: parsed.data.starts_at,
          time_slot_end: parsed.data.ends_at,
          location: null,
          color: null,
        },
      ]
    })

    return reply.header('content-type', 'text/calendar; charset=utf-8').send(
      renderCalendar({
        name: found.name,
        events: [...events, ...diary].sort((one, other) =>
          one.time_slot_start.localeCompare(other.time_slot_start),
        ),
        now: now(),
        domain: 'sage-burner',
      }),
    )
  })
}
