import type { RosterResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, paymentUpdateSchema, withPlaces } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { account, attendance, event, eventOption } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { activeEvent, todayIso } from './events.ts'
import { helpingFor } from './helping.ts'

export interface RosterDeps extends GuardDeps {
  now?: () => Date
}

/**
 * Who is coming to a burn, and recording that they have paid.
 *
 * The direct replacement for the spreadsheet's Members tab. Person-level fields
 * are joined in from `account` rather than copied, so an allergy corrected on
 * someone's own profile page is corrected here in the same moment — which is the
 * point of the account/attendance split.
 */
export const registerRosterRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: RosterDeps,
) => {
  const { requireAdmin } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>(
    '/api/admin/events/:eventId/roster',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const { eventId } = request.params
      const found = await eventFor(eventId)
      if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

      return {
        event: found,
        entries: await rosterFor(eventId, found.member_cap),
      } satisfies RosterResponse
    },
  )

  app.get('/api/admin/events/active/roster', { preHandler: requireAdmin }, async (_request, reply) => {
    void noStore(reply)

    const open = await activeEvent(db, todayIso(now))
    if (open === undefined) return { event: null, entries: [] } satisfies RosterResponse

    const summary = { id: open.id, name: open.name, member_cap: open.member_cap }

    return { event: summary, entries: await rosterFor(open.id, open.member_cap) } satisfies RosterResponse
  })

  app.patch<{ Params: { eventId: string; accountId: string } }>(
    '/api/admin/events/:eventId/attendance/:accountId/payment',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const { eventId, accountId } = request.params
      const parsed = paymentUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      if (Object.keys(parsed.data).length === 0) {
        const [row] = await db
          .select()
          .from(attendance)
          .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
          .limit(1)

        return row === undefined ? reply.code(404).send(errorResponse('not_found')) : { attendance: row }
      }

      const [updated] = await db
        .update(attendance)
        .set(parsed.data)
        .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
        .returning()

      return updated === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : { attendance: updated }
    },
  )

  async function eventFor(eventId: string) {
    const [row] = await db
      .select({ id: event.id, name: event.name, member_cap: event.member_cap })
      .from(event)
      .where(eq(event.id, eventId))
      .limit(1)

    return row
  }

  async function rosterFor(eventId: string, cap: number) {
    const rows = await db
      .select({
        id: attendance.id,
        event_id: attendance.event_id,
        account_id: attendance.account_id,
        joined_at: attendance.joined_at,
        arrival_date: attendance.arrival_date,
        departure_date: attendance.departure_date,
        lodging_option_id: attendance.lodging_option_id,
        lodging: eventOption.label,
        helping_other: attendance.helping_other,
        notes: attendance.notes,
        payment_status: attendance.payment_status,
        payment_date: attendance.payment_date,
        email: account.email,
        name: account.name,
        contact: account.contact,
        allergies_notes: account.allergies_notes,
      })
      .from(attendance)
      .innerJoin(account, eq(account.id, attendance.account_id))
      // Left, so someone who has not said where they are sleeping is still on
      // the roster. An inner join would quietly shorten the list an organiser
      // counts heads from.
      .leftJoin(eventOption, eq(eventOption.id, attendance.lodging_option_id))
      .where(eq(attendance.event_id, eventId))

    // One query for the whole page's ticks rather than one per row.
    const helping = await helpingFor(
      db,
      rows.map((row) => row.id),
    )

    // Ordered and cut by the shared rule rather than here, so #79's member-facing
    // list gives the same answer when it arrives.
    return withPlaces(
      rows.map((row) => ({ ...row, helping_option_ids: helping.get(row.id) ?? [] })),
      cap,
    )
  }
}
