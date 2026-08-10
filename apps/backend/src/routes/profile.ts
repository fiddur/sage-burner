import type { AttendanceUpdate, ProfileResponse } from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  attendanceUpdateSchema,
  errorResponse,
  profilePage,
  profileUpdateSchema,
} from '@sage-burner/shared'
import { and, eq, gte, ne, sql } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { allOf } from '../db/conditions.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { isEmptyPatch } from '../db/patch.ts'
import { whyNothingWritten } from '../db/refusals.ts'
import { account, attendance, event, eventOption } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { allergyTickIdsFor, writeAllergyTicks } from './allergy-ticks.ts'
import { openEventNow, todayIso } from './events.ts'
import { areHelpingOptions, helpingIdsFor, writeHelping } from './helping.ts'
import { cardEntry, INTRODUCED } from './threads.ts'

export interface ProfileDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

const stayOrderCondition = ({ arrival_date, departure_date }: AttendanceUpdate) => {
  if (arrival_date === undefined && departure_date === undefined) return undefined
  if (arrival_date !== undefined && departure_date !== undefined) return undefined
  if (arrival_date === null || departure_date === null) return undefined
  if (arrival_date !== undefined) {
    return sql`${attendance.departure_date} is null or ${arrival_date} <= ${attendance.departure_date}`
  }

  return sql`${attendance.arrival_date} is null or ${attendance.arrival_date} <= ${departure_date}`
}

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

export const writeStay = (
  db: Database,
  mine: SQL,
  columns: Omit<AttendanceUpdate, 'helping_option_ids'>,
  helping: readonly string[] | undefined,
): (typeof attendance.$inferSelect)[] =>
  db.transaction((tx) => {
    const rows = isEmptyPatch(columns)
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

export const registerProfileRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: ProfileDeps,
) => {
  const { requireApproved, requireMember } = createGuards({ db, sessions })

  const announceIntroduction = async (accountId: string) => {
    const name = await displayName(db, accountId)

    const stays = await db
      .select({ id: attendance.id, event_id: attendance.event_id })
      .from(attendance)
      .innerJoin(event, eq(event.id, attendance.event_id))
      .where(and(eq(attendance.account_id, accountId), gte(event.end_date, todayIso(now))))

    for (const stay of stays) {
      await cardEntry(db, {
        stay,
        who: { account_id: accountId, name },
        kind: 'introduced',
        body: INTRODUCED,
        at: now(),
      })

      await tellAttendees(
        db,
        notify,
        stay.event_id,
        {
          category: 'introduction_written',
          body: `${name} says who they are.`,
          link: profilePage(accountId),
        },
        { except: [accountId] },
      )
    }
  }

  const profileFor = async (accountId: string) => {
    const [row] = await db
      .select({
        account_id: account.id,
        email: account.email,
        name: account.name,
        contact: account.contact,
        allergies_notes: account.allergies_notes,
        introduction: account.introduction,
      })
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1)

    return row === undefined
      ? undefined
      : { ...row, allergy_item_ids: await allergyTickIdsFor(db, accountId) }
  }

  app.get(apiRoutes.getMyProfile.fastify, { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const profile = await profileFor(viewer.account_id)
    if (profile === undefined) return sendError(reply, 404)

    return { profile } satisfies ProfileResponse
  })

  app.patch(apiRoutes.updateMyProfile.fastify, { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(profileUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const { allergy_item_ids: ticks, ...columns } = body

    const before = await profileFor(viewer.account_id)
    if (before === undefined) return sendError(reply, 404)

    if (!isEmptyPatch(columns) || ticks !== undefined) {
      try {
        db.transaction((tx) => {
          if (!isEmptyPatch(columns)) {
            tx.update(account).set(columns).where(eq(account.id, viewer.account_id)).run()
          }
          if (ticks !== undefined) writeAllergyTicks(tx, viewer.account_id, ticks)
        })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }
    }

    const profile = await profileFor(viewer.account_id)
    if (profile === undefined) return sendError(reply, 404)

    if (profile.introduction !== before.introduction && (profile.introduction ?? '').trim() !== '') {
      await announceIntroduction(viewer.account_id)
    }

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

      const found = await openEventNow(db, now, request.params.eventId)
      if (found === undefined) return sendError(reply, 404)

      const mine = allOf(eq(attendance.event_id, found.id), eq(attendance.account_id, viewer.account_id))

      const { helping_option_ids: helping, ...columns } = body

      const problem = await stayProblem(db, found.id, viewer.account_id, body)
      if (problem !== undefined) return reply.code(problem).send(errorResponse(problemBody(problem)))

      let updated: (typeof attendance.$inferSelect)[]
      try {
        updated = writeStay(db, mine, columns, helping)
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }

      const [first] = updated

      if (first !== undefined) {
        return { attendance: { ...first, helping_option_ids: await helpingIdsFor(db, first.id) } }
      }

      const why = await whyNothingWritten(db, attendance, mine)

      return sendError(reply, why === 'not_found' ? 404 : 400)
    },
  )
}
