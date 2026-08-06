import type { EventAttendeesResponse, MyBurn, MyBurnsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, attendanceCreateSchema, errorResponse, placeTransferSchema } from '@sage-burner/shared'
import { TransactionRollbackError, and, asc, eq, gte, isNotNull, ne, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { account, accountAvatar, attendance, event } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { openEvent, todayIso } from './events.ts'
import { helpingFor, helpingIdsFor } from './helping.ts'

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

/** Somebody's stay at a burn, with the helping ticks that live in another table. */
export const stayAt = async (db: Database, eventId: string, accountId: string) => {
  const [row] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
    .limit(1)

  // The ticks travel with the row everywhere it is returned, so a caller never
  // has to know they live in another table.
  return row === undefined ? undefined : { ...row, helping_option_ids: await helpingIdsFor(db, row.id) }
}

/** Whose account holds an attendance — for telling somebody their role changed. */
export const accountForAttendance = async (db: Database, attendanceId: string) => {
  const [row] = await db
    .select({ account_id: attendance.account_id })
    .from(attendance)
    .where(eq(attendance.id, attendanceId))
    .limit(1)

  return row?.account_id
}

/**
 * Saying somebody is coming to a burn.
 *
 * Two callers, which is why it is here rather than inside a route: a member's own "I
 * am coming", and spending an invite with the upcoming burn ticked (#224). The
 * defaults are the interesting part, and having them in one place is what stops the
 * two doors leading to differently-shaped rows.
 *
 * Idempotent — saying it twice is the same statement, not an error. A double click, a
 * retried request and a second tab all land here.
 *
 * Answers `undefined` for a burn that has ended and for one that never existed, which
 * are deliberately the same answer: distinguishing them would tell an unrelated caller
 * that an id is real.
 */
export const joinBurn = async (db: Database, eventId: string, accountId: string, now: () => Date) => {
  const found = await openEvent(db, todayIso(now), eventId)
  if (found === undefined) return undefined

  // A shortcut, not the guarantee — two requests can both pass it before either
  // writes. `attendance_event_account_idx` is what actually holds the invariant, so
  // losing to it means someone else just said the same thing, which is the answer
  // this gives anyway.
  const existing = await stayAt(db, found.id, accountId)
  if (existing !== undefined) return { stay: existing, created: false }

  try {
    await db.insert(attendance).values({
      id: randomUUID(),
      event_id: found.id,
      account_id: accountId,
      joined_at: now().toISOString(),
      payment_status: 'unpaid',
      // The whole burn, which is what almost everyone means by coming to it.
      // Written rather than left null and prefilled in the form: an organiser
      // reading the roster wants the common answer already there, and the people
      // arriving late or leaving early are the ones who should have to change
      // something.
      arrival_date: found.start_date,
      departure_date: found.end_date,
    })
  } catch (error) {
    if (!isAlreadyJoined(error)) throw error

    const raced = await stayAt(db, found.id, accountId)
    return raced === undefined ? undefined : { stay: raced, created: false }
  }

  const made = await stayAt(db, found.id, accountId)
  return made === undefined ? undefined : { stay: made, created: true }
}

/** Whose attendance an account holds at this burn, or nothing if they are not coming. */
export const attendanceFor = async (db: Database, eventId: string, accountId: string) => {
  const [row] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
    .limit(1)

  return row?.id
}

/**
 * The two writes that move a place, as one — and only while what they were decided
 * on still holds.
 *
 * The route checks that the giver has paid and the taker has not, several awaits
 * before these run. Both are re-stated in the WHERE clauses rather than trusted: two
 * givers naming the same taker, or a transfer racing an organiser recording a
 * payment, would otherwise destroy a paid place, since the taker was already paid
 * and the giver's row is deleted regardless. Nothing can interleave under the
 * synchronous driver today, but that is the driver's property rather than this
 * code's, and `joinBurn` above guards its identically-shaped window explicitly.
 *
 * Exported for the test that proves it, like `writeStay`: the window cannot be
 * opened through `inject`, which serialises requests.
 */
export const handOverPlace = (
  db: Database,
  giver: { id: string; payment_date: string | null },
  takerAttendanceId: string,
): boolean => {
  try {
    db.transaction((tx) => {
      const taken = tx
        .update(attendance)
        .set({ payment_status: 'paid', payment_date: giver.payment_date })
        .where(and(eq(attendance.id, takerAttendanceId), ne(attendance.payment_status, 'paid')))
        .returning({ id: attendance.id })
        .all()

      const given = tx
        .delete(attendance)
        .where(and(eq(attendance.id, giver.id), eq(attendance.payment_status, 'paid')))
        .returning({ id: attendance.id })
        .all()

      if (taken.length === 0 || given.length === 0) tx.rollback()
    })

    return true
  } catch (failure) {
    if (failure instanceof TransactionRollbackError) return false
    throw failure
  }
}

export interface AttendanceDeps extends GuardDeps {
  now?: () => Date
  /** Told when a place is handed to them — the one person here who did not click. */
  notify?: Notifier
}

/**
 * Saying you are coming to a burn — and an organiser saying it for you.
 *
 * Being in the community and coming to a particular burn are separate acts:
 * approval admits you once, and then you decide burn by burn. This is that
 * second decision, and the row it creates is what arrival dates, dreams and
 * shifts hang off later.
 *
 * **Named by event id, not by "active".** These were `…/events/active/attendance`
 * while there was one place to see a burn and it was whichever one was next. The
 * details page lists every burn still to come and offers to join any of them
 * (#184), and "the active burn" is the soonest-ending one — so an active-scoped
 * join could not say yes to the second burn on that page. The id says which,
 * which is what the caller already knew.
 */
export const registerAttendanceRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date(), notify = async () => undefined }: AttendanceDeps,
) => {
  const { requireApproved, requireMember } = createGuards({ db, sessions })

  const joinedRow = (eventId: string, accountId: string) => stayAt(db, eventId, accountId)

  /**
   * Every burn somebody's own page shows them, and their stay at each.
   *
   * The split into `coming` and `past` is made here rather than in the browser: it
   * is a comparison against a clock, and a page deciding it from `end_date` would
   * answer differently either side of midnight depending on the reader's timezone.
   *
   * `coming` is every burn that has not ended, joined or not — joining is what the
   * page is for. `past` is only the ones with a stay, since a burn somebody never
   * came to is not their history.
   *
   * `requireApproved`, unlike the writes below. This is what fills the burn selector,
   * and an organiser holding `admin` without `member` has to be able to choose the
   * burn they are setting up — they get every coming burn with `attendance: null` on
   * each and an empty `past`, which is exactly what `choosableBurns` expects. Under
   * `requireMember` that account got a 403, the provider swallowed it, and they faced
   * the empty selector this whole design exists to prevent.
   */
  app.get(apiRoutes.getMyBurns.fastify, { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const today = todayIso(now)
    const mine = and(eq(attendance.event_id, event.id), eq(attendance.account_id, viewer.account_id))

    const rows = await db
      .select({ event, attendance })
      .from(event)
      // Left, so a burn they have not joined is still offered. An inner join would
      // reduce this to the ones they are already coming to, which is the opposite
      // of what the page needs.
      .leftJoin(attendance, mine)
      .where(or(gte(event.end_date, today), isNotNull(attendance.id)))
      .orderBy(asc(event.start_date), asc(event.slug))

    const helping = await helpingFor(
      db,
      rows.flatMap((row) => (row.attendance === null ? [] : [row.attendance.id])),
    )

    const asMine = (row: (typeof rows)[number]): MyBurn => ({
      // Named field by field rather than spread, for the reason `rolesFor` gives:
      // an object spread is exempt from excess-property checking, so a column added
      // to `event` would reach the client without anybody deciding it should.
      event: {
        id: row.event.id,
        name: row.event.name,
        slug: row.event.slug,
        start_date: row.event.start_date,
        end_date: row.event.end_date,
        start_time: row.event.start_time,
        end_time: row.event.end_time,
      },
      attendance:
        row.attendance === null
          ? null
          : { ...row.attendance, helping_option_ids: helping.get(row.attendance.id) ?? [] },
    })

    return {
      coming: rows.filter((row) => row.event.end_date >= today).map(asMine),
      past: rows
        .filter((row) => row.event.end_date < today)
        .reverse()
        .map(asMine),
    } satisfies MyBurnsResponse
  })

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.joinEvent.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

      const joined = await joinBurn(db, request.params.eventId, viewer.account_id, now)
      if (joined === undefined) return reply.code(404).send(errorResponse('not_found'))

      return joined.created ? reply.code(201).send({ attendance: joined.stay }) : { attendance: joined.stay }
    },
  )

  app.delete<{ Params: { eventId: string } }>(
    apiRoutes.leaveEvent.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

      const found = await openEvent(db, todayIso(now), request.params.eventId)
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
    },
  )

  /**
   * Handing your paid place to somebody who has not paid (#23).
   *
   * The exit that was missing. Withdrawing is refused once you have paid — what a
   * refund means is #31's question — so a paid member who cannot come had no way out
   * and their place could not reach the waiting list. This moves the payment and
   * then leaves.
   *
   * **One-sided and immediate.** The money is settled between the two of them
   * offline, which is what the burn's transfer text tells them to do, so an accept
   * step would only let a place sit in limbo.
   *
   * **The giver leaves the burn**, rather than staying on unpaid. Everything they
   * had signed up for there goes with the row — helping ticks, meal shifts, lead
   * teams, dream helpers, and since this issue the dream they were facilitating,
   * which empties rather than disappearing.
   *
   * Refusals are deliberately different: a taker who is not coming to this burn is a
   * **404** because there is no such place to hand over, while a giver with nothing
   * paid and a taker who has already paid are **409** — the rows exist and the
   * request contradicts them.
   *
   * Naming yourself as the taker needs no check of its own: giving requires having
   * paid, so the taker is then the same already-paid row, and the check below
   * refuses it. A guard for it was written, and a mutation showed it could never
   * fire.
   */
  app.post<{ Params: { eventId: string } }>(
    apiRoutes.transferMyPlace.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

      const parsed = placeTransferSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const open = await openEvent(db, todayIso(now), request.params.eventId)
      if (open === undefined) return reply.code(404).send(errorResponse('not_found'))

      const mine = await stayAt(db, open.id, viewer.account_id)
      if (mine === undefined) return reply.code(404).send(errorResponse('not_found'))
      if (mine.payment_status !== 'paid') return reply.code(409).send(errorResponse('conflict'))

      const theirs = await stayAt(db, open.id, parsed.data.to_account_id)
      if (theirs === undefined) return reply.code(404).send(errorResponse('not_found'))
      if (theirs.payment_status === 'paid') return reply.code(409).send(errorResponse('conflict'))

      if (!handOverPlace(db, mine, theirs.id)) return reply.code(409).send(errorResponse('conflict'))

      // Outside it, and only to the taker: the giver did this themselves. A push
      // service being down must not undo a place changing hands.
      await notify(parsed.data.to_account_id, {
        category: 'payment',
        body: `Your place at ${open.name} is paid — somebody transferred theirs to you.`,
        link: '/members',
      })

      return reply.code(204).send()
    },
  )

  /**
   * Who is coming, by name, so members can fill in the lists they share.
   *
   * Two columns, which is all the lead-roles register needs to offer somebody a
   * role. Kept separate from the member roster (#159) rather than folded into it:
   * a route that selects two columns cannot leak a third by someone later widening
   * what it returns, and this one is reached from a picker on every register page
   * rather than from a page somebody chose to open.
   */
  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getEventAttendees.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const attendees = await db
        .select({ account_id: account.id, name: account.name, avatar: accountAvatar.updated_at })
        .from(attendance)
        .innerJoin(account, eq(account.id, attendance.account_id))
        .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
        .where(eq(attendance.event_id, request.params.eventId))
        .orderBy(asc(account.name), asc(account.id))

      return { attendees } satisfies EventAttendeesResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(apiRoutes.adminAddAttendance.fastify, async (request, reply) => {
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
  })

  app.delete<{ Params: { eventId: string; accountId: string } }>(
    apiRoutes.adminRemoveAttendance.fastify,
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
