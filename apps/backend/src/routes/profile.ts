import type { AttendanceUpdate, ProfileResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { attendanceUpdateSchema, errorResponse, profileUpdateSchema } from '@sage-burner/shared'
import { and, eq, ne, sql } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { account, attendance, eventOption } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { viewerFor } from './auth.ts'
import { activeEvent, todayIso } from './events.ts'
import { areHelpingOptions, helpingIdsFor, setHelping } from './helping.ts'

export interface ProfileDeps extends GuardDeps {
  now?: () => Date
}

/**
 * The stay-order rule for a PATCH carrying only one date, as SQL.
 *
 * A partial body can invert the stored pair without ever containing both values,
 * so the schema's refinement cannot see it. Comparing against a row read a moment
 * earlier is check-then-act; composing the condition into the `WHERE` decides it
 * against the row as it is at write time.
 *
 * `events.ts` and `sessions.ts` had the same problem and answered it the other
 * way, by reading the row and checking the merge in JavaScript — because their
 * rules grew to span fields a SQL comparison could not see soundly. This one is
 * still two fixed-width dates, where the comparison is sound and the statement is
 * one query rather than two.
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
 * Whether this burn's lodging list will take one more person here.
 *
 * Scoped to the event **and** the kind, not just the id: the select disables a
 * full option but the API takes what it is sent, so a direct PATCH could
 * otherwise name another burn's option, or a `helping` one — which has no
 * capacity and so could never be full. Both are refused as invalid, the same as
 * an id that names nothing.
 *
 * Their own current choice does not count against them, or re-saving an
 * unrelated field would refuse the bed they are already in.
 */
const lodgingVerdict = async (
  db: Database,
  eventId: string,
  optionId: string,
  accountId: string,
): Promise<'ok' | 'invalid' | 'full'> => {
  const [option] = await db
    .select({ capacity: eventOption.capacity })
    .from(eventOption)
    .where(
      and(eq(eventOption.id, optionId), eq(eventOption.event_id, eventId), eq(eventOption.kind, 'lodging')),
    )
    .limit(1)

  if (option === undefined) return 'invalid'
  if (option.capacity === null) return 'ok'

  const others = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(
      and(
        eq(attendance.event_id, eventId),
        eq(attendance.lodging_option_id, optionId),
        ne(attendance.account_id, accountId),
      ),
    )

  return others.length >= option.capacity ? 'full' : 'ok'
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

    // `helping_option_ids` lives in its own table, so it never reaches `set()`.
    const { helping_option_ids: helping, ...columns } = parsed.data

    // Counted and compared, not composed into the statement: at forty-odd people
    // two members taking the last mattress in the same millisecond is not a
    // failure worth machinery, and an organiser moves one of them in ten seconds.
    // Refusing is the point — a disabled `<option>` is presentation, and the API
    // takes whatever it is sent.
    if (parsed.data.lodging_option_id != null) {
      const verdict = await lodgingVerdict(db, found.id, parsed.data.lodging_option_id, viewer.account_id)
      if (verdict === 'invalid') return reply.code(400).send(errorResponse('bad_request'))
      if (verdict === 'full') return reply.code(409).send(errorResponse('conflict'))
    }

    // Checked before the write, like the lodging verdict above. Validating after
    // it means a rejected tick answers 400 with the columns already committed —
    // and the form sends both in one PATCH, so an organiser deleting an option
    // while someone has the page open is enough to produce it.
    if (helping !== undefined && !(await areHelpingOptions(db, found.id, helping))) {
      return reply.code(400).send(errorResponse('bad_request'))
    }

    let updated: (typeof attendance.$inferSelect)[]
    try {
      // No columns to set is not an error: the body may be empty, or may carry
      // only the helping ticks, which live in their own table. `set({})` is not
      // valid SQL, so both read instead of writing.
      updated =
        Object.keys(columns).length === 0
          ? await db.select().from(attendance).where(mine).limit(1)
          : await db
              .update(attendance)
              .set(columns)
              .where(and(mine, stayOrderCondition(columns)))
              .returning()
    } catch (failure) {
      // A `lodging_option_id` naming no option. The foreign key is the authority
      // rather than a pre-read, which would be a second query saying the same.
      if (isForeignKeyViolation(failure)) return reply.code(400).send(errorResponse('bad_request'))
      throw failure
    }

    const [first] = updated

    if (first !== undefined) {
      if (helping !== undefined) await setHelping(db, first.id, helping)

      return { attendance: { ...first, helping_option_ids: await helpingIdsFor(db, first.id) } }
    }

    // Nothing was written, which is either "not coming to this burn" or "that
    // would put the departure before the arrival". Asked rather than inferred.
    const [existing] = await db.select().from(attendance).where(mine).limit(1)

    return existing === undefined
      ? reply.code(404).send(errorResponse('not_found'))
      : reply.code(400).send(errorResponse('bad_request'))
  })
}
