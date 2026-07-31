import type { AttendanceUpdate, ProfileResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { attendanceUpdateSchema, errorResponse, profileUpdateSchema } from '@sage-burner/shared'
import { and, eq, sql } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { account, attendance } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { viewerFor } from './auth.ts'
import { activeEvent, todayIso } from './events.ts'

export interface ProfileDeps extends GuardDeps {
  now?: () => Date
}

/**
 * The stay-order rule for a PATCH carrying only one date, as SQL.
 *
 * A partial body can invert the stored pair without ever containing both values,
 * so the schema's refinement cannot see it. Comparing against a row read a moment
 * earlier is check-then-act; composing the condition into the `WHERE` decides it
 * against the row as it is at write time. Same shape as `dateOrderCondition` in
 * `events.ts`, and the same reason.
 */
const stayOrderCondition = ({ arrival_date, departure_date }: AttendanceUpdate) => {
  if (arrival_date === undefined && departure_date === undefined) return undefined
  // Both present: the schema's own refinement already compared them.
  if (arrival_date !== undefined && departure_date !== undefined) return undefined
  // Null clears one end, and a comparison against null is never a conflict.
  if (arrival_date === null || departure_date === null) return undefined
  if (arrival_date !== undefined) {
    return sql`${attendance.departure_date} is null or ${arrival_date} <= ${attendance.departure_date}`
  }

  return sql`${attendance.arrival_date} is null or ${attendance.arrival_date} <= ${departure_date}`
}

/**
 * A member maintaining their own record.
 *
 * Two halves, because they have two lifetimes: who you are lives on the account
 * and outlives every burn, while when you arrive and where you sleep belong to
 * one stay. Both routes derive whose row it is from the session, so there is no
 * id in either body to get wrong or to tamper with.
 */
export const registerProfileRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: ProfileDeps,
) => {
  const { requireMember } = createGuards({ db, sessions })

  const profileFor = async (accountId: string) => {
    const [row] = await db
      .select({
        account_id: account.id,
        email: account.email,
        name: account.name,
        contact: account.contact,
        allergies_notes: account.allergies_notes,
      })
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1)

    return row
  }

  app.get('/api/me/profile', { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const profile = await profileFor(viewer.account_id)
    if (profile === undefined) return reply.code(404).send(errorResponse('not_found'))

    return { profile } satisfies ProfileResponse
  })

  app.patch('/api/me/profile', { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const parsed = profileUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    // `set({})` is not valid SQL, so an empty body would be a 500 rather than the
    // no-op it plainly is.
    if (Object.keys(parsed.data).length > 0) {
      await db.update(account).set(parsed.data).where(eq(account.id, viewer.account_id))
    }

    const profile = await profileFor(viewer.account_id)
    if (profile === undefined) return reply.code(404).send(errorResponse('not_found'))

    return { profile } satisfies ProfileResponse
  })

  app.patch('/api/events/active/attendance', { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const parsed = attendanceUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const found = await activeEvent(db, todayIso(now))
    if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

    const mine = and(eq(attendance.event_id, found.id), eq(attendance.account_id, viewer.account_id))

    if (Object.keys(parsed.data).length === 0) {
      const [row] = await db.select().from(attendance).where(mine).limit(1)

      return row === undefined ? reply.code(404).send(errorResponse('not_found')) : { attendance: row }
    }

    const [updated] = await db
      .update(attendance)
      .set(parsed.data)
      .where(and(mine, stayOrderCondition(parsed.data)))
      .returning()

    if (updated !== undefined) return { attendance: updated }

    // Nothing was written, which is either "not coming to this burn" or "that
    // would put the departure before the arrival". Asked rather than inferred.
    const [existing] = await db.select().from(attendance).where(mine).limit(1)

    return existing === undefined
      ? reply.code(404).send(errorResponse('not_found'))
      : reply.code(400).send(errorResponse('bad_request'))
  })
}
