import type { AttendanceResponse, EventAttendeesResponse, MyBurn, MyBurnsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, attendanceCreateSchema, placeTransferSchema } from '@sage-burner/shared'
import { and, asc, eq, gte, isNotNull, ne, or, TransactionRollbackError } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors.ts'
import { account, accountAvatar, attendance, event } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { openEventNow, todayIso } from './events.ts'
import { helpingFor, helpingIdsFor } from './helping.ts'
import { cardEntry, JOINED } from './threads.ts'

export const isAlreadyJoined = (error: unknown) => isUniqueViolation(error, 'attendance.event_id')

export const stayAt = async (db: Database, eventId: string, accountId: string) => {
  const [row] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
    .limit(1)

  return row === undefined ? undefined : { ...row, helping_option_ids: await helpingIdsFor(db, row.id) }
}

export const joinBurn = async (db: Database, eventId: string, accountId: string, now: () => Date) => {
  const found = await openEventNow(db, now, eventId)
  if (found === undefined) return undefined

  const existing = await stayAt(db, found.id, accountId)
  if (existing !== undefined) return { stay: existing, created: false }

  try {
    await db.insert(attendance).values({
      id: randomUUID(),
      event_id: found.id,
      account_id: accountId,
      joined_at: now().toISOString(),
      payment_status: 'unpaid',
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
  now: () => Date
  notify?: Notifier
}

/**
 * The card and the bell a new arrival earns. Exported because the join route is not the only
 * path in: redeeming an invite joins too, and the one join that most deserves a card — a brand
 * new member's — was the silent one (#478).
 */
export const announceJoined = async (
  db: Database,
  notify: Notifier,
  joined: { stay: { id: string; event_id: string }; account_id: string },
  now: () => Date,
): Promise<void> => {
  const name = await displayName(db, joined.account_id)

  await cardEntry(db, {
    stay: joined.stay,
    who: { account_id: joined.account_id, name },
    kind: 'joined',
    body: JOINED,
    at: now(),
  })

  await tellAttendees(
    db,
    notify,
    joined.stay.event_id,
    { category: 'member_joined', body: `${name} is coming.`, link: '/members' },
    { except: [joined.account_id] },
  )
}

export const registerAttendanceRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: AttendanceDeps,
) => {
  const { requireApproved, requireMember } = createGuards({ db, sessions })

  const joinedRow = (eventId: string, accountId: string) => stayAt(db, eventId, accountId)

  app.get(apiRoutes.getMyBurns.fastify, { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const today = todayIso(now)
    const mine = and(eq(attendance.event_id, event.id), eq(attendance.account_id, viewer.account_id))

    const rows = await db
      .select({ event, attendance })
      .from(event)
      .leftJoin(attendance, mine)
      .where(or(gte(event.end_date, today), isNotNull(attendance.id)))
      .orderBy(asc(event.start_date), asc(event.slug))

    const helping = await helpingFor(
      db,
      rows.flatMap((row) => (row.attendance === null ? [] : [row.attendance.id])),
    )

    const asMine = (row: (typeof rows)[number]): MyBurn => ({
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
      if (viewer === undefined) return sendError(reply, 401)

      const joined = await joinBurn(db, request.params.eventId, viewer.account_id, now)
      if (joined === undefined) return sendError(reply, 404)

      if (joined.created) {
        await announceJoined(db, notify, { stay: joined.stay, account_id: viewer.account_id }, now)
      }

      const answer = { attendance: joined.stay } satisfies AttendanceResponse

      return joined.created ? reply.code(201).send(answer) : answer
    },
  )

  app.delete<{ Params: { eventId: string } }>(
    apiRoutes.leaveEvent.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const found = await openEventNow(db, now, request.params.eventId)
      if (found === undefined) return sendError(reply, 404)

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

      return existing === undefined ? sendError(reply, 404) : sendError(reply, 409)
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.transferMyPlace.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const body = bodyOf(placeTransferSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const open = await openEventNow(db, now, request.params.eventId)
      if (open === undefined) return sendError(reply, 404)

      const mine = await stayAt(db, open.id, viewer.account_id)
      if (mine === undefined) return sendError(reply, 404)
      if (mine.payment_status !== 'paid') return sendError(reply, 409)

      const theirs = await stayAt(db, open.id, body.to_account_id)
      if (theirs === undefined) return sendError(reply, 404)
      if (theirs.payment_status === 'paid') return sendError(reply, 409)

      if (!handOverPlace(db, mine, theirs.id)) return sendError(reply, 409)

      await notify(body.to_account_id, {
        category: 'payment',
        body: `Your place at ${open.name} is paid — somebody transferred theirs to you.`,
        link: '/members',
      })

      return reply.code(204).send()
    },
  )

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

    const body = bodyOf(attendanceCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const existing = await joinedRow(request.params.eventId, body.account_id)
    if (existing !== undefined) return { attendance: existing } satisfies AttendanceResponse

    const [burn] = await db
      .select({ start_date: event.start_date, end_date: event.end_date })
      .from(event)
      .where(eq(event.id, request.params.eventId))
      .limit(1)

    try {
      await db.insert(attendance).values({
        id: randomUUID(),
        event_id: request.params.eventId,
        account_id: body.account_id,
        joined_at: now().toISOString(),
        payment_status: 'unpaid',
        arrival_date: burn?.start_date ?? null,
        departure_date: burn?.end_date ?? null,
      })
    } catch (error) {
      if (isForeignKeyViolation(error)) return sendError(reply, 404)
      if (!isAlreadyJoined(error)) throw error

      const raced = await joinedRow(request.params.eventId, body.account_id)

      return raced === undefined
        ? sendError(reply, 409)
        : ({ attendance: raced } satisfies AttendanceResponse)
    }

    const made = await joinedRow(request.params.eventId, body.account_id)
    if (made === undefined) return sendError(reply, 404)

    return reply.code(201).send({ attendance: made } satisfies AttendanceResponse)
  })

  app.delete<{ Params: { eventId: string; accountId: string } }>(
    apiRoutes.adminRemoveAttendance.fastify,
    async (request, reply) => {
      void noStore(reply)

      const removed = await db
        .delete(attendance)
        .where(
          and(
            eq(attendance.event_id, request.params.eventId),
            eq(attendance.account_id, request.params.accountId),
          ),
        )
        .returning({ id: attendance.id })

      return removed.length > 0 ? reply.code(204).send() : sendError(reply, 404)
    },
  )
}
