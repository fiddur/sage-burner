import type { MyAttendanceResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { attendanceCreateSchema, errorResponse } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { attendance, event } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { viewerFor } from './auth.ts'
import { activeEvent, todayIso } from './events.ts'

/**
 * The one-row-per-person-per-burn index, which is what makes joining idempotent.
 *
 * Exported because it is the only part of the race that is testable here:
 * `inject` serialises two requests to the admin route, so that catch never fires
 * under test even though two organisers clicking at once over HTTP will reach it.
 * `attendance.test.ts` pins this predicate against a real violation instead, so
 * at least the message it matches cannot drift unnoticed.
 */
export const isAlreadyJoined = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed: attendance\./i.test(error.message)

export interface AttendanceDeps extends GuardDeps {
  now?: () => Date
}

/**
 * Saying you are coming to a burn — and an organiser saying it for you.
 *
 * Being in the community and coming to a particular burn are separate acts:
 * approval admits you once, and then you decide burn by burn. This is that
 * second decision, and the row it creates is what arrival dates, dreams and
 * shifts hang off later.
 */
export const registerAttendanceRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: AttendanceDeps,
) => {
  const { requireAdmin, requireMember } = createGuards({ db, sessions })

  const joinedRow = async (eventId: string, accountId: string) => {
    const [row] = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
      .limit(1)

    return row
  }

  app.get('/api/events/active/attendance', { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const found = await activeEvent(db, todayIso(now))
    if (found === undefined) return { event: null, attendance: null } satisfies MyAttendanceResponse

    return {
      event: { id: found.id, name: found.name, slug: found.slug },
      attendance: (await joinedRow(found.id, viewer.account_id)) ?? null,
    } satisfies MyAttendanceResponse
  })

  app.post('/api/events/active/attendance', { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const found = await activeEvent(db, todayIso(now))
    if (found === undefined) return reply.code(409).send(errorResponse('conflict'))

    // Idempotent: saying it twice is the same statement, not an error. A double
    // click, a retried request and a second tab all land here.
    //
    // The read is a shortcut, not the guarantee — two requests can both pass it
    // before either writes. `attendance_event_account_idx` is what actually holds
    // the invariant, so losing to it means someone else just said the same thing,
    // which is the answer this route gives anyway.
    const existing = await joinedRow(found.id, viewer.account_id)
    if (existing !== undefined) return { attendance: existing }

    try {
      await db.insert(attendance).values({
        id: randomUUID(),
        event_id: found.id,
        account_id: viewer.account_id,
        joined_at: now().toISOString(),
        payment_status: 'unpaid',
        // The whole burn, which is what almost everyone means by coming to it.
        // Written rather than left null and prefilled in the form: an organiser
        // reading the roster wants the common answer already there, and the
        // people arriving late or leaving early are the ones who should have to
        // change something.
        arrival_date: found.start_date,
        departure_date: found.end_date,
      })
    } catch (error) {
      if (!isAlreadyJoined(error)) throw error

      return { attendance: await joinedRow(found.id, viewer.account_id) }
    }

    return reply.code(201).send({ attendance: await joinedRow(found.id, viewer.account_id) })
  })

  app.delete('/api/events/active/attendance', { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const found = await activeEvent(db, todayIso(now))
    if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

    // Refused once anything has been paid, rather than guessed at: what a refund
    // means is a real decision and #31 owns it. Deleting the row here would
    // silently discard the record that money changed hands.
    const removed = await db
      .delete(attendance)
      .where(
        and(
          eq(attendance.event_id, found.id),
          eq(attendance.account_id, viewer.account_id),
          eq(attendance.payment_status, 'unpaid'),
        ),
      )
      .returning({ id: attendance.id })

    if (removed.length > 0) return reply.code(204).send()

    const existing = await joinedRow(found.id, viewer.account_id)

    return existing === undefined
      ? reply.code(404).send(errorResponse('not_found'))
      : reply.code(409).send(errorResponse('conflict'))
  })

  app.post<{ Params: { eventId: string } }>(
    '/api/admin/events/:eventId/attendance',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const parsed = attendanceCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const existing = await joinedRow(request.params.eventId, parsed.data.account_id)
      if (existing !== undefined) return { attendance: existing }

      // Only for the dates. A missing event is still the foreign key's to
      // reject below, so this read cannot answer 404 on its own.
      const [burn] = await db
        .select({ start_date: event.start_date, end_date: event.end_date })
        .from(event)
        .where(eq(event.id, request.params.eventId))
        .limit(1)

      try {
        await db.insert(attendance).values({
          id: randomUUID(),
          event_id: request.params.eventId,
          account_id: parsed.data.account_id,
          joined_at: now().toISOString(),
          payment_status: 'unpaid',
          // The same default an organiser would otherwise type in for them.
          arrival_date: burn?.start_date ?? null,
          departure_date: burn?.end_date ?? null,
        })
      } catch (error) {
        // No pre-read for either id: the foreign keys already reject a missing
        // event or account, and asking first would be a second query that says
        // the same thing. Narrowed to those failures so a real bug still surfaces
        // as a 500 rather than as a confident 404.
        if (isForeignKeyViolation(error)) return reply.code(404).send(errorResponse('not_found'))
        // The same race the member route has, and one it shares with it: an
        // organiser adding someone at the moment they add themselves.
        if (!isAlreadyJoined(error)) throw error

        return { attendance: await joinedRow(request.params.eventId, parsed.data.account_id) }
      }

      return reply
        .code(201)
        .send({ attendance: await joinedRow(request.params.eventId, parsed.data.account_id) })
    },
  )

  app.delete<{ Params: { eventId: string; accountId: string } }>(
    '/api/admin/events/:eventId/attendance/:accountId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      // No payment guard here, unlike the member's own withdrawal: an organiser
      // removing someone who has paid is a decision they are making deliberately,
      // and refusing it would leave them no way to correct a mistaken add.
      const removed = await db
        .delete(attendance)
        .where(
          and(
            eq(attendance.event_id, request.params.eventId),
            eq(attendance.account_id, request.params.accountId),
          ),
        )
        .returning({ id: attendance.id })

      return removed.length > 0 ? reply.code(204).send() : reply.code(404).send(errorResponse('not_found'))
    },
  )
}
