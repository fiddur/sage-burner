import type {
  Session,
  SessionResponse,
  SessionsResponse,
  SessionUpdate,
  ThreadEntryKind,
} from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  dreamPage,
  errorResponse,
  hasValidTimeSlot,
  helperSchema,
  sessionCreateSchema,
  sessionUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import {
  account,
  accountAvatar,
  attendance,
  place,
  session,
  sessionHelper,
  sessionSupport,
  thread,
} from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { openEventNow } from './events.ts'
import { addEntry, renameThread, threadFor, threadIdFor } from './threads.ts'

export interface SessionDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

type DreamRow = Omit<typeof session.$inferSelect, 'facilitator_attendance_id'> & {
  facilitator_account_id: string | null
  thread_id: string | null
}

const dreamColumns = {
  id: session.id,
  event_id: session.event_id,
  title: session.title,
  facilitator_account_id: attendance.account_id,
  description: session.description,
  repeatable: session.repeatable,
  time_slot_start: session.time_slot_start,
  time_slot_end: session.time_slot_end,
  place_id: session.place_id,
  thread_id: thread.id,
}

const dreamRows = (db: Database, where: SQL) =>
  db
    .select(dreamColumns)
    .from(session)
    .leftJoin(attendance, eq(attendance.id, session.facilitator_attendance_id))
    .leftJoin(thread, and(eq(thread.entity_type, 'session'), eq(thread.entity_id, session.id)))
    .where(where)

interface People {
  helpers: ReadonlyMap<string, Session['helpers']>
  support: ReadonlyMap<string, { people: Session['supporters']; mine: boolean }>
}

const peopleFor = async (db: Database, ids: string[], mine: string | undefined): Promise<People> => {
  const helpers = new Map<string, Session['helpers']>()
  const support = new Map<string, { people: Session['supporters']; mine: boolean }>()

  if (ids.length === 0) return { helpers, support }

  const helperRows = await db
    .select({ dreamId: sessionHelper.session_id, accountId: account.id, name: account.name })
    .from(sessionHelper)
    .innerJoin(attendance, eq(attendance.id, sessionHelper.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .where(inArray(sessionHelper.session_id, ids))
    .orderBy(asc(account.name), asc(account.id))

  const supportRows = await db
    .select({
      dreamId: sessionSupport.session_id,
      attendanceId: sessionSupport.attendance_id,
      accountId: account.id,
      name: account.name,
      avatar: accountAvatar.updated_at,
    })
    .from(sessionSupport)
    .innerJoin(attendance, eq(attendance.id, sessionSupport.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
    .where(inArray(sessionSupport.session_id, ids))
    .orderBy(asc(account.name), asc(account.id))

  for (const row of helperRows) {
    helpers.set(row.dreamId, [
      ...(helpers.get(row.dreamId) ?? []),
      { account_id: row.accountId, name: row.name },
    ])
  }

  for (const row of supportRows) {
    const sofar = support.get(row.dreamId) ?? { people: [], mine: false }
    support.set(row.dreamId, {
      people: [...sofar.people, { account_id: row.accountId, name: row.name, avatar: row.avatar }],
      mine: sofar.mine || row.attendanceId === mine,
    })
  }

  return { helpers, support }
}

const asDream = (row: DreamRow, { helpers, support }: People): Session => ({
  id: row.id,
  event_id: row.event_id,
  title: row.title,
  facilitator_account_id: row.facilitator_account_id,
  description: row.description,
  repeatable: row.repeatable,
  time_slot_start: row.time_slot_start,
  time_slot_end: row.time_slot_end,
  place_id: row.place_id,
  thread_id: row.thread_id,
  helpers: helpers.get(row.id) ?? [],
  supporters: support.get(row.id)?.people ?? [],
  support_count: support.get(row.id)?.people.length ?? 0,
  supported_by_me: support.get(row.id)?.mine ?? false,
})

const scheduleLine = (before: DreamRow, after: DreamRow): string => {
  if (before.time_slot_start === null && after.time_slot_start !== null) return 'put it in the schedule'
  if (before.time_slot_start !== null && after.time_slot_start === null) return 'took it off the schedule'
  if (before.time_slot_start === null && after.time_slot_start === null) {
    return after.place_id === null ? 'took the place off it' : 'said where it would be'
  }

  return 'moved it in the schedule'
}

const sessionsFor = async (db: Database, eventId: string, mine: string | undefined): Promise<Session[]> => {
  const rows = await dreamRows(db, eq(session.event_id, eventId)).orderBy(
    asc(isNull(session.time_slot_start)),
    asc(session.time_slot_start),
    asc(session.title),
  )

  const people = await peopleFor(
    db,
    rows.map((row) => row.id),
    mine,
  )

  return rows.map((row) => asDream(row, people))
}

const oneDream = async (db: Database, row: DreamRow, mine: string | undefined): Promise<Session> =>
  asDream(row, await peopleFor(db, [row.id], mine))

interface Refusal {
  code: 400 | 404
  error: 'bad_request' | 'not_found'
}

interface Arranging {
  dream: DreamRow
  mine: string | undefined
  callerId: string | undefined
}

interface Attending extends Arranging {
  mine: string
}

const placeIsOnThisBurn = async (db: Database, eventId: string, placeId: string | null | undefined) => {
  if (placeId == null) return true

  const [found] = await db
    .select({ id: place.id })
    .from(place)
    .where(and(eq(place.id, placeId), eq(place.event_id, eventId)))
    .limit(1)

  return found !== undefined
}

type Spot = { ok: true; attendanceId: string | null | undefined } | { ok: false }

const facilitatorSpot = async (
  db: Database,
  eventId: string,
  accountId: string | null | undefined,
): Promise<Spot> => {
  if (accountId === undefined) return { ok: true, attendanceId: undefined }
  if (accountId === null) return { ok: true, attendanceId: null }

  const found = await attendanceFor(db, eventId, accountId)

  return found === undefined ? { ok: false } : { ok: true, attendanceId: found }
}

export const registerSessionRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: SessionDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const dreamsOf = async (eventId: string, mine: string | undefined): Promise<SessionsResponse> => ({
    sessions: await sessionsFor(db, eventId, mine),
  })

  const mineAt = async (request: FastifyRequest, eventId: string) => {
    const viewer = await viewerFor(request, { db, sessions })

    return viewer === undefined ? undefined : await attendanceFor(db, eventId, viewer.account_id)
  }

  const facilitatorMoved = async (
    by: string | undefined,
    before: DreamRow,
    after: string | null | undefined,
  ) => {
    if (after === undefined || after === before.facilitator_account_id) return

    const was = before.facilitator_account_id

    if (was !== null) await tell(by, was, `You are no longer facilitating ${before.title}`)
    if (after !== null) await tell(by, after, `You are facilitating ${before.title}`)

    const line = await facilitatorLine(by, was, after)
    if (line !== undefined) await noteOnDream(before, 'facilitator', by, line)
  }

  const facilitatorLine = async (by: string | undefined, was: string | null, after: string | null) => {
    if (after === null) {
      if (was === null) return undefined

      return was === by
        ? 'stepped back from facilitating'
        : `took ${await displayName(db, was)} off facilitating`
    }

    if (after === by) return was === null ? 'is facilitating it' : 'took over as facilitator'

    return `asked ${await displayName(db, after)} to facilitate`
  }

  const tell = async (by: string | undefined, accountId: string, message: string) => {
    if (accountId === by) return

    await notify(accountId, { category: 'dream_role', body: message, link: '/dreams' })
  }

  const noteOnDream = async (
    dream: { id: string; event_id: string; title: string },
    kind: ThreadEntryKind,
    by: string | undefined,
    body: string,
    talkedOn?: string,
  ) => {
    await addEntry(
      db,
      {
        thread_id: talkedOn ?? (await threadFor(db, 'session', dream)),
        kind,
        author_account_id: by ?? null,
        body,
      },
      now(),
    )
  }

  const dreamEdited = async (
    before: DreamRow,
    body: SessionUpdate,
    after: DreamRow,
    by: string | undefined,
  ) => {
    if (body.title !== undefined && body.title !== before.title) {
      const talk = await threadFor(db, 'session', before)
      await noteOnDream(before, 'renamed', by, `renamed it to “${after.title}”`, talk)
      await renameThread(db, talk, after.title)
    }

    const moved =
      (body.time_slot_start !== undefined && body.time_slot_start !== before.time_slot_start) ||
      (body.time_slot_end !== undefined && body.time_slot_end !== before.time_slot_end) ||
      (body.place_id !== undefined && body.place_id !== before.place_id)

    if (moved) await noteOnDream(before, 'scheduled', by, scheduleLine(before, after))

    const detailed =
      (body.description !== undefined && body.description !== before.description) ||
      (body.repeatable !== undefined && body.repeatable !== before.repeatable)

    if (detailed) await noteOnDream(before, 'edited', by, 'edited the details')
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getSessions.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const mine = await mineAt(request, request.params.eventId)

      return withVersion(reply, await dreamsOf(request.params.eventId, mine))
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.offerSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(sessionCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const open = await openEventNow(db, now, request.params.eventId)
      if (open === undefined) return sendError(reply, 404)

      if (!(await placeIsOnThisBurn(db, open.id, body.place_id))) {
        return sendError(reply, 400)
      }
      const spot = await facilitatorSpot(db, open.id, body.facilitator_account_id)
      if (!spot.ok) return sendError(reply, 400)

      const { facilitator_account_id: wanted, ...fields } = body
      const row: DreamRow = {
        ...fields,
        id: randomUUID(),
        event_id: open.id,
        facilitator_account_id: wanted ?? null,
        thread_id: null,
      }

      let threadId: string
      try {
        threadId = db.transaction((tx) => {
          tx.insert(session)
            .values({
              ...fields,
              id: row.id,
              event_id: open.id,
              facilitator_attendance_id: spot.attendanceId ?? null,
            })
            .run()

          return threadIdFor(tx, { type: 'session', id: row.id, event_id: open.id, title: row.title })
        })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }

      await addEntry(
        db,
        {
          thread_id: threadId,
          kind: 'offered',
          author_account_id: viewer.account_id,
          body: 'offered this dream',
        },
        now(),
      )

      await tellAttendees(
        db,
        notify,
        open.id,
        {
          category: 'dream_offered',
          body: `${await displayName(db, viewer.account_id)} offered a dream: ${row.title}`,
          link: dreamPage(open.id, row.id),
        },
        { except: [viewer.account_id] },
      )

      const dream: Session = {
        ...row,
        thread_id: threadId,
        helpers: [],
        supporters: [],
        support_count: 0,
        supported_by_me: false,
      }

      return reply.code(201).send({ session: dream } satisfies SessionResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(sessionUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const [existing] = await dreamRows(db, eq(session.id, request.params.id)).limit(1)

      const open = existing === undefined ? undefined : await openEventNow(db, now, existing.event_id)
      if (existing === undefined || open === undefined) {
        return sendError(reply, 404)
      }

      const mine = await mineAt(request, existing.event_id)

      if (Object.keys(body).length === 0) {
        return { session: await oneDream(db, existing, mine) } satisfies SessionResponse
      }

      if (!hasValidTimeSlot({ ...existing, ...body })) {
        return sendError(reply, 400)
      }

      if (!(await placeIsOnThisBurn(db, existing.event_id, body.place_id))) {
        return sendError(reply, 400)
      }
      const spot = await facilitatorSpot(db, existing.event_id, body.facilitator_account_id)
      if (!spot.ok) return sendError(reply, 400)

      if (await refuseIfStale(request, reply, () => dreamsOf(existing.event_id, mine))) return reply

      const { facilitator_account_id: _wanted, ...fields } = body
      const patch =
        spot.attendanceId === undefined ? fields : { ...fields, facilitator_attendance_id: spot.attendanceId }

      try {
        await db.update(session).set(patch).where(eq(session.id, request.params.id))
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }

      const [row] = await dreamRows(db, eq(session.id, request.params.id)).limit(1)

      if (row === undefined) return sendError(reply, 404)

      const by = (await viewerFor(request, { db, sessions }))?.account_id

      await dreamEdited(existing, body, row, by)
      await facilitatorMoved(by, existing, body.facilitator_account_id)

      return await withCollectionVersion(
        reply,
        { session: await oneDream(db, row, mine) } satisfies SessionResponse,
        () => dreamsOf(existing.event_id, mine),
      )
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const [existing] = await db
        .select({ event_id: session.event_id, title: session.title })
        .from(session)
        .where(eq(session.id, request.params.id))
        .limit(1)

      if (existing === undefined) return sendError(reply, 404)

      const open = await openEventNow(db, now, existing.event_id)
      if (open === undefined) return sendError(reply, 404)

      const deleted = await db
        .delete(session)
        .where(and(eq(session.id, request.params.id), eq(session.event_id, open.id)))
        .returning({ id: session.id })

      if (deleted.length === 0) return sendError(reply, 404)

      const viewer = await viewerFor(request, { db, sessions })

      await noteOnDream(
        { id: request.params.id, event_id: open.id, title: existing.title },
        'withdrawn',
        viewer?.account_id,
        'withdrew this dream',
      )

      return reply.code(204).send()
    },
  )

  const onOpenBurn = async (
    request: FastifyRequest<{ Params: { id: string } }>,
  ): Promise<Refusal | Arranging> => {
    const [dream] = await dreamRows(db, eq(session.id, request.params.id)).limit(1)
    if (dream === undefined) return { code: 404, error: 'not_found' }

    const open = await openEventNow(db, now, dream.event_id)
    if (open === undefined) return { code: 404, error: 'not_found' }

    const viewer = await viewerFor(request, { db, sessions })
    const mine = viewer === undefined ? undefined : await attendanceFor(db, dream.event_id, viewer.account_id)

    return { dream, mine, callerId: viewer?.account_id }
  }

  const asAttendee = async (
    request: FastifyRequest<{ Params: { id: string } }>,
  ): Promise<Refusal | Attending> => {
    const found = await onOpenBurn(request)
    if ('code' in found) return found

    const mine = found.mine
    if (mine === undefined) return { code: 400, error: 'bad_request' }

    return { ...found, mine }
  }

  app.post<{ Params: { id: string } }>(
    apiRoutes.helpWithSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(helperSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const found = await onOpenBurn(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const theirs = await attendanceFor(db, found.dream.event_id, body.account_id)
      if (theirs === undefined) return sendError(reply, 400)

      const added = await db
        .insert(sessionHelper)
        .values({ session_id: found.dream.id, attendance_id: theirs })
        .onConflictDoNothing()
        .returning()

      if (added.length > 0) {
        await tell(found.callerId, body.account_id, `You are helping with ${found.dream.title}`)
        await noteOnDream(
          found.dream,
          'helper',
          found.callerId,
          body.account_id === found.callerId
            ? 'put a hand up to help'
            : `asked ${await displayName(db, body.account_id)} to help`,
        )
      }

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
    },
  )

  app.delete<{ Params: { id: string; accountId: string } }>(
    apiRoutes.stopHelpingWithSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const found = await onOpenBurn(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const theirs = await attendanceFor(db, found.dream.event_id, request.params.accountId)
      if (theirs === undefined) return sendError(reply, 400)

      const gone = await db
        .delete(sessionHelper)
        .where(and(eq(sessionHelper.session_id, found.dream.id), eq(sessionHelper.attendance_id, theirs)))
        .returning()

      if (gone.length > 0) {
        await tell(
          found.callerId,
          request.params.accountId,
          `You are no longer helping with ${found.dream.title}`,
        )
        await noteOnDream(
          found.dream,
          'helper',
          found.callerId,
          request.params.accountId === found.callerId
            ? 'cannot help after all'
            : `took ${await displayName(db, request.params.accountId)} off helping`,
        )
      }

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
    },
  )

  app.post<{ Params: { id: string } }>(
    apiRoutes.supportSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      await db
        .insert(sessionSupport)
        .values({ session_id: found.dream.id, attendance_id: found.mine })
        .onConflictDoNothing()

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSupportForSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      await db
        .delete(sessionSupport)
        .where(
          and(eq(sessionSupport.session_id, found.dream.id), eq(sessionSupport.attendance_id, found.mine)),
        )

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
    },
  )
}
