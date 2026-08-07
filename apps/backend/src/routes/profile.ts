import type { AttendanceUpdate, ProfileResponse } from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, attendanceUpdateSchema, errorResponse, profileUpdateSchema } from '@sage-burner/shared'
import { and, eq, ne, sql } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { allOf } from '../db/conditions.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { whyNothingWritten } from '../db/refusals.ts'
import { account, attendance, eventOption } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { allergyTickIdsFor, writeAllergyTicks } from './allergy-ticks.ts'
import { openEventNow } from './events.ts'
import { areHelpingOptions, helpingIdsFor, writeHelping } from './helping.ts'

export interface ProfileDeps extends GuardDeps {
  now: () => Date
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
 * What is wrong with a stay update, before anything is written.
 *
 * Both checks live here rather than in the handler because both must happen
 * *before* the column write: the form sends the ticks and the columns in one
 * PATCH, so rejecting either afterwards answers an error with the rest already
 * saved.
 */
const stayProblem = async (
  db: Database,
  eventId: string,
  accountId: string,
  update: AttendanceUpdate,
): Promise<400 | 409 | undefined> => {
  if (update.lodging_option_id != null) {
    const verdict = await lodgingVerdict(db, eventId, update.lodging_option_id, accountId)
    if (verdict === 'invalid') return 400
    if (verdict === 'full') return 409
  }

  if (update.helping_option_ids !== undefined) {
    if (!(await areHelpingOptions(db, eventId, update.helping_option_ids))) return 400
  }

  return undefined
}

const problemBody = (code: 400 | 409) => (code === 409 ? 'conflict' : 'bad_request')

/**
 * The stay's two writes, as one.
 *
 * The columns live on `attendance` and the ticks in `attendance_helping`, but
 * they arrive in a single PATCH, so committing one without the other would
 * answer an error over a half-saved stay. `stayProblem` catches what it can
 * beforehand; this is what makes the answer honest when the pre-check's own
 * window closes underneath it.
 *
 * Exported for the test that proves the rollback — the window it guards cannot
 * be opened through `inject`, which serialises requests.
 */
export const writeStay = (
  db: Database,
  mine: SQL,
  columns: Omit<AttendanceUpdate, 'helping_option_ids'>,
  helping: readonly string[] | undefined,
): (typeof attendance.$inferSelect)[] =>
  db.transaction((tx) => {
    // No columns to set is not an error: the body may be empty, or may carry only
    // the helping ticks, which live in their own table. `set({})` is not valid
    // SQL, so both read instead of writing.
    const rows =
      Object.keys(columns).length === 0
        ? tx.select().from(attendance).where(mine).limit(1).all()
        : tx
            .update(attendance)
            .set(columns)
            .where(and(mine, stayOrderCondition(columns)))
            .returning()
            .all()

    const [first] = rows
    if (first !== undefined && helping !== undefined) writeHelping(tx, first.id, helping)

    return rows
  })

/**
 * A member maintaining their own record.
 *
 * Two halves, because they have two lifetimes: who you are lives on the account
 * and outlives every burn, while when you arrive and where you sleep belong to
 * one stay. Both routes derive whose row it is from the session, so there is no
 * id in either body to get wrong or to tamper with.
 */
export const registerProfileRoutes = (app: FastifyInstance, { db, sessions, now }: ProfileDeps) => {
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

    // The ticks travel with the row wherever it is returned, so a caller never has
    // to know they live in another table — the same as a stay's helping options.
    return row === undefined
      ? undefined
      : { ...row, allergy_item_ids: await allergyTickIdsFor(db, accountId) }
  }

  app.get(apiRoutes.getMyProfile.fastify, { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const profile = await profileFor(viewer.account_id)
    if (profile === undefined) return sendError(reply, 404)

    return { profile } satisfies ProfileResponse
  })

  app.patch(apiRoutes.updateMyProfile.fastify, { preHandler: requireMember }, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(profileUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const { allergy_item_ids: ticks, ...columns } = body

    // One transaction, because the columns and the ticks arrive together and a
    // half-saved profile would answer an error over a record that did change.
    // `set({})` is not valid SQL, so an empty column set is skipped rather than
    // written — an empty body is the no-op it plainly is.
    if (Object.keys(columns).length > 0 || ticks !== undefined) {
      try {
        db.transaction((tx) => {
          if (Object.keys(columns).length > 0) {
            tx.update(account).set(columns).where(eq(account.id, viewer.account_id)).run()
          }
          if (ticks !== undefined) writeAllergyTicks(tx, viewer.account_id, ticks)
        })
      } catch (failure) {
        // A tick naming an item that is not there — misspelled, or deleted while
        // this request was in flight. The foreign key is the only authority, with no
        // pre-read beside it: a read would say exactly what the key says and could go
        // stale between the two. (`updateMyStay` keeps its pre-read because
        // `areHelpingOptions` checks a burn-and-kind pairing the key cannot see;
        // there is no such second rule here.) Both halves are one transaction, so
        // this answers 400 over a profile that did not change.
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }
    }

    const profile = await profileFor(viewer.account_id)
    if (profile === undefined) return sendError(reply, 404)

    return { profile } satisfies ProfileResponse
  })

  app.patch<{ Params: { eventId: string } }>(
    apiRoutes.updateMyStay.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(attendanceUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      // Named by id rather than scoped to the active burn, so a stay at the second
      // burn on the details page can be filled in — and still refused once that
      // burn has ended, which is what `openEvent` decides.
      const found = await openEventNow(db, now, request.params.eventId)
      if (found === undefined) return sendError(reply, 404)

      // `allOf` rather than `and`: this reaches an `UPDATE` as well as two reads, and
      // drizzle types `and` as possibly undefined — which there is the whole table.
      const mine = allOf(eq(attendance.event_id, found.id), eq(attendance.account_id, viewer.account_id))

      // `helping_option_ids` lives in its own table, so it never reaches `set()`.
      const { helping_option_ids: helping, ...columns } = body

      const problem = await stayProblem(db, found.id, viewer.account_id, body)
      if (problem !== undefined) return reply.code(problem).send(errorResponse(problemBody(problem)))

      let updated: (typeof attendance.$inferSelect)[]
      try {
        updated = writeStay(db, mine, columns, helping)
      } catch (failure) {
        // A `lodging_option_id` naming no option, or a tick naming an option that
        // has just been deleted. The foreign key is the authority rather than a
        // pre-read, which would be a second query saying the same — and because
        // both writes are one transaction, neither half survives being told no.
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }

      const [first] = updated

      if (first !== undefined) {
        return { attendance: { ...first, helping_option_ids: await helpingIdsFor(db, first.id) } }
      }

      // Nothing was written, which is either "not coming to this burn" or "that
      // would put the departure before the arrival" — see `whyNothingWritten`.
      const why = await whyNothingWritten(db, attendance, mine)

      return sendError(reply, why === 'not_found' ? 404 : 400)
    },
  )
}
