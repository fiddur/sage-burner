import type { Session, SessionResponse, SessionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  errorResponse,
  hasValidTimeSlot,
  sessionCreateSchema,
  sessionUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { session } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { viewerFor } from './auth.ts'
import { activeEvent, todayIso } from './events.ts'

export interface SessionDeps extends GuardDeps {
  now?: () => Date
}

const sessionsFor = (db: Database, eventId: string): Promise<Session[]> =>
  db
    .select()
    .from(session)
    .where(eq(session.event_id, eventId))
    // Unscheduled dreams last, then by when they happen. `asc` puts nulls first
    // in SQLite, so the null-ness is sorted on explicitly rather than relied on.
    .orderBy(asc(isNull(session.time_slot_start)), asc(session.time_slot_start), asc(session.title))

/**
 * Dreams — the member-offered workshops, ceremonies and happenings.
 *
 * A null time slot means *offered but not yet scheduled*, which is the normal
 * state for most of them right up until the burn, not an error.
 *
 * Members rather than admins, because the schedule is theirs to arrange: #20
 * says any member can administrate it. The host is the member who offered it and
 * is not accepted from the body — a dream in someone else's name is not an edit
 * anyone should be able to make by hand.
 */
export const registerSessionRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: SessionDeps,
) => {
  const { requireMember } = createGuards({ db, sessions })

  app.get('/api/events/active/sessions', { preHandler: requireMember }, async (_request, reply) => {
    void noStore(reply)

    const open = await activeEvent(db, todayIso(now))
    if (open === undefined) return { sessions: [] } satisfies SessionsResponse

    return { sessions: await sessionsFor(db, open.id) } satisfies SessionsResponse
  })

  app.post('/api/events/active/sessions', { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const parsed = sessionCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const open = await activeEvent(db, todayIso(now))
    if (open === undefined) return reply.code(404).send(errorResponse('not_found'))

    const row: Session = {
      ...parsed.data,
      id: randomUUID(),
      event_id: open.id,
      host_account_id: viewer.account_id,
    }

    // The place is checked by the foreign key rather than by a read first: a
    // read-then-insert would let the place be deleted in between and still
    // insert.
    try {
      await db.insert(session).values(row)
    } catch (failure) {
      if (isForeignKeyViolation(failure)) return reply.code(400).send(errorResponse('bad_request'))
      throw failure
    }

    return reply.code(201).send({ session: row } satisfies SessionResponse)
  })

  app.patch<{ Params: { id: string } }>(
    '/api/sessions/:id',
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const parsed = sessionUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const open = await activeEvent(db, todayIso(now))
      const [existing] = await db.select().from(session).where(eq(session.id, request.params.id)).limit(1)

      // Scoped to the burn that is open, like every other member-facing route:
      // a dream from a finished burn is history, and an id noted while it was
      // current should not still be a way to rewrite it.
      if (existing === undefined || open === undefined || existing.event_id !== open.id) {
        return reply.code(404).send(errorResponse('not_found'))
      }

      if (Object.keys(parsed.data).length === 0) return { session: existing } satisfies SessionResponse

      // The rule applied to the row as it would be, because a body carrying one
      // end of the slot cannot be judged on its own — `hasValidTimeSlot` is the
      // same check the schema makes when both ends are present. Not composed
      // into the WHERE: these are ISO instants, and comparing them as SQL
      // strings is wrong when the ends differ in fractional-second precision.
      if (!hasValidTimeSlot({ ...existing, ...parsed.data })) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      let updated: Session[]
      try {
        updated = await db
          .update(session)
          .set(parsed.data)
          .where(eq(session.id, request.params.id))
          .returning()
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(400).send(errorResponse('bad_request'))
        throw failure
      }

      const [row] = updated

      return row === undefined ? reply.code(404).send(errorResponse('not_found')) : { session: row }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const open = await activeEvent(db, todayIso(now))
      if (open === undefined) return reply.code(404).send(errorResponse('not_found'))

      const deleted = await db
        .delete(session)
        .where(and(eq(session.id, request.params.id), eq(session.event_id, open.id)))
        .returning({ id: session.id })

      if (deleted.length === 0) return reply.code(404).send(errorResponse('not_found'))

      return reply.code(204).send()
    },
  )
}
