import type {
  Meeting,
  MeetingPoint,
  MeetingPointEntry,
  MeetingPointResponse,
  MeetingPointsResponse,
  MeetingResponse,
  MeetingsResponse,
} from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  decisionSchema,
  meetingCreateSchema,
  meetingPointCreateSchema,
  meetingPointUpdateSchema,
  meetingsPage,
  meetingUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { account, event, meeting, meetingPoint, thread } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName, namedBy, reachedByMention, tellAttendees } from '../push/notify.ts'
import { openEventNow, todayIso } from './events.ts'
import { addEntry, threadFor, threadIdFor } from './threads.ts'

export interface MeetingDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

const pointColumns = {
  id: meetingPoint.id,
  event_id: meetingPoint.event_id,
  author_account_id: meetingPoint.author_account_id,
  author_name: account.name,
  title: meetingPoint.title,
  body: meetingPoint.body,
  decision: meetingPoint.decision,
  decided_note: meetingPoint.decided_note,
  created_at: meetingPoint.created_at,
  thread_id: thread.id,
}

const listing = (db: Database) =>
  db
    .select(pointColumns)
    .from(meetingPoint)
    .leftJoin(account, eq(account.id, meetingPoint.author_account_id))
    .leftJoin(thread, and(eq(thread.entity_type, 'point'), eq(thread.entity_id, meetingPoint.id)))

const pointsFor = async (db: Database, eventId: string): Promise<MeetingPointEntry[]> =>
  await listing(db)
    .where(eq(meetingPoint.event_id, eventId))
    .orderBy(asc(meetingPoint.created_at), asc(meetingPoint.id))

const onePoint = async (db: Database, id: string): Promise<MeetingPointEntry | undefined> => {
  const [row] = await listing(db).where(eq(meetingPoint.id, id)).limit(1)

  return row
}

const pointOnOpenBurn = async (
  db: Database,
  now: () => Date,
  id: string,
): Promise<MeetingPoint | undefined> => {
  const [row] = await db
    .select()
    .from(meetingPoint)
    .innerJoin(event, eq(meetingPoint.event_id, event.id))
    .where(and(eq(meetingPoint.id, id), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.meeting_point
}

const meetingOnOpenBurn = async (db: Database, now: () => Date, id: string): Promise<Meeting | undefined> => {
  const [row] = await db
    .select()
    .from(meeting)
    .innerJoin(event, eq(meeting.event_id, event.id))
    .where(and(eq(meeting.id, id), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.meeting
}

export const registerMeetingRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: MeetingDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const guarded = { preHandler: requireApproved }

  const noteOnPoint = async (
    point: MeetingPoint,
    body: string,
    by: string | undefined,
    kind: 'decided' | 'edited' | 'raised',
    talkedOn?: string,
  ) =>
    await addEntry(
      db,
      {
        thread_id: talkedOn ?? (await threadFor(db, 'point', point)),
        kind,
        author_account_id: by ?? null,
        body,
      },
      now(),
    )

  const tellNamed = async (named: readonly string[], who: string, point: MeetingPoint) => {
    await Promise.all(
      named.map(
        async (accountId) =>
          await notify(accountId, {
            category: 'mentioned',
            body: `${who} named you about: ${point.title}`,
            link: meetingsPage(point.event_id, point.id),
          }),
      ),
    )
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getMeetingPoints.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      return { points: await pointsFor(db, request.params.eventId) } satisfies MeetingPointsResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addMeetingPoint.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(meetingPointCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const open = await openEventNow(db, now, request.params.eventId)
      if (open === undefined) return sendError(reply, 404)

      const row = {
        id: randomUUID(),
        event_id: open.id,
        author_account_id: viewer.account_id,
        title: body.title,
        body: body.body,
        decision: null,
        decided_note: null,
        created_at: now().toISOString(),
      } satisfies MeetingPoint

      const threadId = db.transaction((tx) => {
        tx.insert(meetingPoint).values(row).run()

        return threadIdFor(tx, { type: 'point', id: row.id, event_id: row.event_id, title: row.title })
      })

      await noteOnPoint(row, 'raised this', viewer.account_id, 'raised', threadId)

      const who = await displayName(db, viewer.account_id)
      const named = await reachedByMention(db, await namedBy(db, row.body, row.event_id, viewer.account_id))

      await tellNamed(named, who, row)

      await tellAttendees(
        db,
        notify,
        row.event_id,
        {
          category: 'point_raised',
          body: `${who} raised: ${row.title}`,
          link: meetingsPage(row.event_id, row.id),
        },
        { except: [viewer.account_id, ...named] },
      )

      const answered = await onePoint(db, row.id)
      if (answered === undefined) return sendError(reply, 404)

      return reply.code(201).send({ point: answered } satisfies MeetingPointResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateMeetingPoint.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(meetingPointUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const existing = await pointOnOpenBurn(db, now, request.params.id)
      if (existing === undefined) return sendError(reply, 404)
      if (existing.author_account_id !== viewer.account_id) return sendError(reply, 403)

      if (!isEmptyPatch(body)) {
        const patched = await patchRow(db, meetingPoint, eq(meetingPoint.id, existing.id), body)
        if (patched.kind !== 'ok') return sendError(reply, 404)

        if (patched.row.title !== existing.title || patched.row.body !== existing.body) {
          await noteOnPoint(patched.row, 'went over it', viewer.account_id, 'edited')
        }

        const already = new Set(await namedBy(db, existing.body, existing.event_id, viewer.account_id))
        const newly = (
          await reachedByMention(
            db,
            await namedBy(db, patched.row.body, existing.event_id, viewer.account_id),
          )
        ).filter((accountId) => !already.has(accountId))

        await tellNamed(newly, await displayName(db, viewer.account_id), patched.row)
      }

      const answered = await onePoint(db, existing.id)
      if (answered === undefined) return sendError(reply, 404)

      return { point: answered } satisfies MeetingPointResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteMeetingPoint.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const existing = await pointOnOpenBurn(db, now, request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const mine = existing.author_account_id === viewer.account_id
      if (!mine && !viewer.roles.includes('admin')) return sendError(reply, 403)

      await db.delete(meetingPoint).where(eq(meetingPoint.id, existing.id))

      return reply.code(204).send()
    },
  )

  app.put<{ Params: { id: string } }>(apiRoutes.decidePoint.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(decisionSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const existing = await pointOnOpenBurn(db, now, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    const [row] = await db
      .update(meetingPoint)
      .set({ decision: body.decision, decided_note: body.decided_note })
      .where(eq(meetingPoint.id, existing.id))
      .returning()

    if (row === undefined) return sendError(reply, 404)

    const who = await displayName(db, viewer.account_id)

    if (row.decision !== null && row.decision !== existing.decision) {
      await noteOnPoint(row, row.decision, viewer.account_id, 'decided')

      await tellAttendees(
        db,
        notify,
        row.event_id,
        {
          category: 'point_decided',
          body: `${who} recorded a decision on: ${row.title}`,
          link: meetingsPage(row.event_id, row.id),
        },
        { except: [viewer.account_id] },
      )
    }

    if (row.decision === null && existing.decision !== null) {
      await noteOnPoint(row, 'reopened this', viewer.account_id, 'edited')
    }

    const answered = await onePoint(db, row.id)
    if (answered === undefined) return sendError(reply, 404)

    return { point: answered } satisfies MeetingPointResponse
  })

  app.get<{ Params: { eventId: string } }>(apiRoutes.getMeetings.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const meetings = await db
      .select()
      .from(meeting)
      .where(eq(meeting.event_id, request.params.eventId))
      .orderBy(asc(meeting.starts_at), asc(meeting.id))

    return { meetings } satisfies MeetingsResponse
  })

  app.post<{ Params: { eventId: string } }>(apiRoutes.addMeeting.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(meetingCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const open = await openEventNow(db, now, request.params.eventId)
    if (open === undefined) return sendError(reply, 404)

    const row = {
      id: randomUUID(),
      event_id: open.id,
      title: body.title,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      link: body.link,
      notes: body.notes,
      created_at: now().toISOString(),
    } satisfies Meeting

    await db.insert(meeting).values(row)

    await tellAttendees(
      db,
      notify,
      row.event_id,
      {
        category: 'meeting_scheduled',
        body: `${await displayName(db, viewer.account_id)} put a meeting in the diary: ${row.title}`,
        link: meetingsPage(row.event_id),
      },
      { except: [viewer.account_id] },
    )

    return reply.code(201).send({ meeting: row } satisfies MeetingResponse)
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updateMeeting.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(meetingUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const existing = await meetingOnOpenBurn(db, now, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    const [row] = await db
      .update(meeting)
      .set({
        title: body.title,
        starts_at: body.starts_at,
        ends_at: body.ends_at,
        link: body.link,
        notes: body.notes,
      })
      .where(eq(meeting.id, existing.id))
      .returning()

    if (row === undefined) return sendError(reply, 404)

    return { meeting: row } satisfies MeetingResponse
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteMeeting.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const existing = await meetingOnOpenBurn(db, now, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    await db.delete(meeting).where(eq(meeting.id, existing.id))

    return reply.code(204).send()
  })
}
