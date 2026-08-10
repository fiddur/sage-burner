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

export const todayIso = (now: () => Date) => now().toISOString().slice(0, 10)

export const activeEvent = async (db: Database, today: string): Promise<Event | undefined> => {
  const [row] = await db
    .select()
    .from(event)
    .where(gte(event.end_date, today))
    .orderBy(asc(event.end_date), asc(event.start_date), asc(event.slug))
    .limit(1)

  return row === undefined ? undefined : asEvent(row)
}

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

export const openEvent = async (db: Database, today: string, eventId: string): Promise<Event | undefined> => {
  const [row] = await db
    .select()
    .from(event)
    .where(and(eq(event.id, eventId), gte(event.end_date, today)))
    .limit(1)

  return row === undefined ? undefined : asEvent(row)
}

export const openEventNow = (db: Database, now: () => Date, eventId: string): Promise<Event | undefined> =>
  openEvent(db, todayIso(now), eventId)

export const activeEventNow = (db: Database, now: () => Date): Promise<Event | undefined> =>
  activeEvent(db, todayIso(now))

const isSlugConflict = (error: unknown) => isUniqueViolation(error, 'event.slug')

export const registerEventRoutes = (app: FastifyInstance, { db, sessions, now }: EventRouteDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const asRead = (found: Event | null): ActiveEventResponse => ({ event: found })

  app.get(apiRoutes.getActiveEvent.fastify, async (_request, reply) => {
    void reply.header('cache-control', 'no-cache')

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
      if (isSlugConflict(error)) return sendError(reply, 409)
      throw error
    }

    return reply.code(201).send({ event: row } satisfies EventResponse)
  })

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateWelcome.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(eventWelcomeUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const open = await openEventNow(db, now, request.params.id)
      if (open === undefined) return sendError(reply, 404)

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

    const [before] = await db.select().from(event).where(eq(event.id, id)).limit(1)
    if (before === undefined) return sendError(reply, 404)

    if (!hasOrderedRange({ ...before, ...body })) {
      return sendError(reply, 400)
    }

    const patched = await patchRow(db, event, eq(event.id, id), body).catch((error: unknown) => {
      if (isSlugConflict(error)) return 'conflict' as const
      if (isCheckViolation(error, 'event_date_order_check')) return 'unordered' as const
      throw error
    })

    if (patched === 'conflict') return sendError(reply, 409)
    if (patched === 'unordered') return sendError(reply, 400)

    if (patched.kind !== 'ok') return sendError(reply, 404)

    return { event: asEvent(patched.row) } satisfies EventResponse
  })
}
