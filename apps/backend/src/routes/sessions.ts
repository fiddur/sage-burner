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
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { attendance, place, session } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { openEvent, todayIso } from './events.ts'

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
 * Whether a place belongs to the burn a dream is on.
 *
 * The foreign key cannot say this: it only knows the place exists, and since #156
 * a place belongs to one burn. Without the check a body could put a dream in
 * another burn's lane — a lane the grid does not draw, so the dream would vanish
 * from the page while still holding a row.
 *
 * `null` is always fine: that is "not scheduled anywhere yet", which is where most
 * dreams sit until close to the burn.
 */
const placeIsOnThisBurn = async (db: Database, eventId: string, placeId: string | null | undefined) => {
  if (placeId == null) return true

  const [found] = await db
    .select({ id: place.id })
    .from(place)
    .where(and(eq(place.id, placeId), eq(place.event_id, eventId)))
    .limit(1)

  return found !== undefined
}

/**
 * Whether a facilitator is coming to the burn their dream is at.
 *
 * The same rule the lead-roles register applies to a lead, and for the same reason:
 * somebody who is not there cannot run it. The foreign key only knows the account
 * exists, so it cannot say this.
 *
 * `null` is always fine — a dream can be offered before anyone has said they will
 * facilitate it, which is the ordinary state of one on the day it is written down.
 */
const facilitatorIsComing = async (db: Database, eventId: string, accountId: string | null | undefined) => {
  if (accountId == null) return true

  const [found] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
    .limit(1)

  return found !== undefined
}

/**
 * Dreams — the member-offered workshops, ceremonies and happenings.
 *
 * A null time slot means *offered but not yet scheduled*, which is the normal
 * state for most of them right up until the burn, not an error.
 *
 * Members rather than admins, because the schedule is theirs to arrange: #20
 * says any member can administrate it — including handing a dream to the member who
 * will facilitate it, which is a body field rather than something to prevent.
 */
export const registerSessionRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: SessionDeps,
) => {
  const { requireMember } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId/sessions',
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      // Reading a finished burn's dreams is reading its record, so this is not
      // scoped the way the writes below are. An empty list for an id that names
      // nothing is the same answer as for a burn nobody offered anything at.
      return { sessions: await sessionsFor(db, request.params.eventId) } satisfies SessionsResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/sessions',
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const parsed = sessionCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

      const open = await openEvent(db, todayIso(now), request.params.eventId)
      if (open === undefined) return reply.code(404).send(errorResponse('not_found'))

      if (!(await placeIsOnThisBurn(db, open.id, parsed.data.place_id))) {
        return reply.code(400).send(errorResponse('bad_request'))
      }
      if (!(await facilitatorIsComing(db, open.id, parsed.data.facilitator_account_id))) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      // The facilitator comes from the body now, defaulting to nobody. It used to be
      // the caller, on the reasoning that a dream in someone else's name was not an
      // edit anyone should make by hand — but offering something for another member
      // to run is exactly that edit, and #198 is it being wanted.
      const row: Session = {
        ...parsed.data,
        id: randomUUID(),
        event_id: open.id,
      }

      // Split deliberately. The foreign key is the authority on the place *existing*,
      // including a concurrent delete a pre-read would miss; `placeIsOnThisBurn` above
      // decides the pairing, which the key cannot see. That check cannot go stale in
      // the direction that matters — no route moves a place between burns, since
      // `placeUpdateSchema` omits `event_id`.
      try {
        await db.insert(session).values(row)
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(400).send(errorResponse('bad_request'))
        throw failure
      }

      return reply.code(201).send({ session: row } satisfies SessionResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/sessions/:id',
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const parsed = sessionUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const [existing] = await db.select().from(session).where(eq(session.id, request.params.id)).limit(1)

      // Scoped to a burn that has not ended, like every other member-facing write:
      // a dream from a finished burn is history, and an id noted while it was
      // current should not still be a way to rewrite it. Not the *active* burn —
      // the selector offers every burn still to come, and a dream can be offered
      // for the one after next.
      const open = existing === undefined ? undefined : await openEvent(db, todayIso(now), existing.event_id)
      if (existing === undefined || open === undefined) {
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

      if (!(await placeIsOnThisBurn(db, existing.event_id, parsed.data.place_id))) {
        return reply.code(400).send(errorResponse('bad_request'))
      }
      if (!(await facilitatorIsComing(db, existing.event_id, parsed.data.facilitator_account_id))) {
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

      const [existing] = await db
        .select({ event_id: session.event_id })
        .from(session)
        .where(eq(session.id, request.params.id))
        .limit(1)

      const open = existing === undefined ? undefined : await openEvent(db, todayIso(now), existing.event_id)
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
