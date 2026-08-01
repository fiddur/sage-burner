import type { Session, SessionResponse, SessionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, sessionCreateSchema, sessionUpdateSchema } from '@sage-burner/shared'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
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

      // `set({})` is not valid SQL, so the one body that never reaches the
      // UPDATE needs a read of its own.
      if (Object.keys(parsed.data).length === 0) {
        const [existing] = await db.select().from(session).where(eq(session.id, request.params.id)).limit(1)

        return existing === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : ({ session: existing } satisfies SessionResponse)
      }

      // The half-a-slot rule as SQL, for the same reason `profile.ts` composes
      // the stay-order rule into its WHERE: a PATCH carrying one end of the slot
      // cannot be judged by the schema alone, and comparing against a row read a
      // moment earlier is check-then-act.
      const whole = slotStaysWhole(parsed.data)

      let updated: Session[]
      try {
        updated = await db
          .update(session)
          .set(parsed.data)
          .where(
            whole === undefined
              ? eq(session.id, request.params.id)
              : and(eq(session.id, request.params.id), whole),
          )
          .returning()
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(400).send(errorResponse('bad_request'))
        throw failure
      }

      const [row] = updated
      if (row !== undefined) return { session: row } satisfies SessionResponse

      // Nothing written is either "no such dream" or "that would leave half a
      // slot". Asked rather than inferred.
      const [stillThere] = await db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, request.params.id))
        .limit(1)

      return stillThere === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : reply.code(400).send(errorResponse('bad_request'))
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const deleted = await db
        .delete(session)
        .where(eq(session.id, request.params.id))
        .returning({ id: session.id })

      if (deleted.length === 0) return reply.code(404).send(errorResponse('not_found'))

      return reply.code(204).send()
    },
  )
}

/**
 * The both-ends-or-neither rule for a PATCH carrying only one end of the slot.
 *
 * A partial body can leave half a slot behind without ever containing both
 * values, so the schema's refinement cannot see it. Composed into the `WHERE`
 * rather than compared after a read, so a concurrent write cannot slip between.
 */
const slotStaysWhole = (update: { time_slot_start?: string | null; time_slot_end?: string | null }) => {
  const { time_slot_start, time_slot_end } = update
  const startGiven = 'time_slot_start' in update
  const endGiven = 'time_slot_end' in update

  // Both present: the schema's own refinement already compared them.
  if (startGiven && endGiven) return undefined
  if (!startGiven && !endGiven) return undefined

  // Setting one end requires the other to already be there; clearing one end
  // requires the other to already be absent.
  return startGiven
    ? time_slot_start === null
      ? isNull(session.time_slot_end)
      : isNotNull(session.time_slot_end)
    : time_slot_end === null
      ? isNull(session.time_slot_start)
      : isNotNull(session.time_slot_start)
}
