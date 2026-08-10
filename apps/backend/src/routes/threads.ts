import type {
  Thread,
  ThreadEntityType,
  ThreadEntry,
  ThreadEntryKind,
  ThreadResponse,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'

import {
  apiRoutes,
  coalesces,
  commentSchema,
  dreamPage,
  INTRODUCTION_EXCERPT,
  profilePage,
} from '@sage-burner/shared'
import { and, asc, count, desc, eq, inArray, max, ne, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database, Transaction } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { account, attendance, event, session, sessionHelper, thread, threadEntry } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName } from '../push/notify.ts'

export interface NewEntry {
  thread_id: string
  kind: ThreadEntryKind
  author_account_id: string | null
  body: string
}

export const threadIdFor = (
  tx: Database | Transaction,
  entity: { type: ThreadEntityType; id: string; event_id: string; title: string },
): string => {
  const [made] = tx
    .insert(thread)
    .values({
      id: randomUUID(),
      event_id: entity.event_id,
      entity_type: entity.type,
      entity_id: entity.id,
      title: entity.title,
    })
    .onConflictDoNothing()
    .returning({ id: thread.id })
    .all()

  if (made !== undefined) return made.id

  const [existing] = tx
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.entity_type, entity.type), eq(thread.entity_id, entity.id)))
    .limit(1)
    .all()

  if (existing === undefined) {
    throw new Error(`thread for ${entity.type} ${entity.id} neither inserted nor found`)
  }

  return existing.id
}

export const renameThread = async (db: Database, threadId: string, title: string) => {
  await db.update(thread).set({ title }).where(eq(thread.id, threadId))
}

export const addEntry = async (db: Database, entry: NewEntry, at: Date) => {
  if (coalesces(entry.kind)) {
    const [newest] = await db
      .select({
        id: threadEntry.id,
        kind: threadEntry.kind,
        author_account_id: threadEntry.author_account_id,
      })
      .from(threadEntry)
      .where(eq(threadEntry.thread_id, entry.thread_id))
      .orderBy(desc(threadEntry.seq))
      .limit(1)

    if (newest?.kind === entry.kind && newest.author_account_id === entry.author_account_id) {
      await db
        .update(threadEntry)
        .set({ body: entry.body, created_at: at.toISOString() })
        .where(eq(threadEntry.id, newest.id))

      return
    }
  }

  await db.insert(threadEntry).values({
    id: randomUUID(),
    thread_id: entry.thread_id,
    kind: entry.kind,
    seq: sql`(select coalesce(max(${threadEntry.seq}), 0) + 1 from ${threadEntry} where ${threadEntry.thread_id} = ${entry.thread_id})`,
    author_account_id: entry.author_account_id,
    body: entry.body,
    created_at: at.toISOString(),
    edited_at: null,
  })
}

export const threadForSession = async (
  db: Database,
  dream: { id: string; event_id: string; title: string },
): Promise<string> => {
  const [row] = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.entity_type, 'session'), eq(thread.entity_id, dream.id)))
    .limit(1)

  return row?.id ?? threadIdFor(db, { type: 'session', ...dream })
}

export const threadForAttendance = async (
  db: Database,
  stay: { id: string; event_id: string; title: string },
): Promise<string> => {
  const [row] = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.entity_type, 'attendance'), eq(thread.entity_id, stay.id)))
    .limit(1)

  return row?.id ?? threadIdFor(db, { type: 'attendance', ...stay })
}

export const JOINED = 'is coming'

export const INTRODUCED = 'says who they are'

export const cardEntry = async (
  db: Database,
  {
    stay,
    who,
    kind,
    body,
    at,
  }: {
    stay: { id: string; event_id: string }
    who: { account_id: string; name: string }
    kind: ThreadEntryKind
    body: string
    at: Date
  },
): Promise<void> => {
  const id = await threadForAttendance(db, { id: stay.id, event_id: stay.event_id, title: who.name })

  await addEntry(db, { thread_id: id, kind, author_account_id: who.account_id, body }, at)
}

export const excerptOf = (introduction: string | null): string | null => {
  const whole = introduction?.trim() ?? ''
  if (whole === '') return null
  if (whole.length <= INTRODUCTION_EXCERPT) return whole

  const cut = whole.slice(0, INTRODUCTION_EXCERPT)
  const space = cut.lastIndexOf(' ')

  return `${(space > INTRODUCTION_EXCERPT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export const recentThreads = async (
  db: Database,
  limit: number,
): Promise<{ id: string; last_at: string; entry_count: number }[]> => {
  const rows = await db
    .select({
      id: threadEntry.thread_id,
      last_at: max(threadEntry.created_at),
      entry_count: count(),
    })
    .from(threadEntry)
    .groupBy(threadEntry.thread_id)
    .orderBy(desc(max(threadEntry.created_at)), desc(threadEntry.thread_id))
    .limit(limit)

  return rows.flatMap((row) =>
    row.last_at === null ? [] : [{ id: row.id, last_at: row.last_at, entry_count: row.entry_count }],
  )
}

export const readThreads = async (
  db: Database,
  ids: readonly string[],
  { newest, counts }: { newest?: number; counts?: ReadonlyMap<string, number> } = {},
): Promise<Thread[]> => {
  if (ids.length === 0) return []

  const rows = await db
    .select({
      id: thread.id,
      event_id: thread.event_id,
      burn: event.name,
      entity_type: thread.entity_type,
      entity_id: thread.entity_id,
      title: thread.title,
      dream: session.id,
      stay: attendance.id,
      subject: account.id,
      subject_name: account.name,
      introduction: account.introduction,
    })
    .from(thread)
    .innerJoin(event, eq(event.id, thread.event_id))
    .leftJoin(session, and(eq(thread.entity_type, 'session'), eq(session.id, thread.entity_id)))
    .leftJoin(attendance, and(eq(thread.entity_type, 'attendance'), eq(attendance.id, thread.entity_id)))
    .leftJoin(account, eq(account.id, attendance.account_id))
    .where(inArray(thread.id, [...ids]))

  const entries = await db
    .select({
      id: threadEntry.id,
      thread_id: threadEntry.thread_id,
      kind: threadEntry.kind,
      body: threadEntry.body,
      created_at: threadEntry.created_at,
      edited_at: threadEntry.edited_at,
      author_id: threadEntry.author_account_id,
      author_name: account.name,
    })
    .from(threadEntry)
    .leftJoin(account, eq(account.id, threadEntry.author_account_id))
    .where(inArray(threadEntry.thread_id, [...ids]))
    .orderBy(asc(threadEntry.thread_id), asc(threadEntry.seq))

  const held = new Map<string, ThreadEntry[]>()
  for (const row of entries) {
    held.set(row.thread_id, [
      ...(held.get(row.thread_id) ?? []),
      {
        id: row.id,
        kind: row.kind,
        author: row.author_id === null ? null : { account_id: row.author_id, name: row.author_name },
        body: row.body,
        created_at: row.created_at,
        edited_at: row.edited_at,
      },
    ])
  }

  const byId = new Map(rows.map((row) => [row.id, row]))

  return ids.flatMap((id) => {
    const row = byId.get(id)
    if (row === undefined) return []

    const all = held.get(id) ?? []
    const shown = newest === undefined ? all : all.slice(Math.max(0, all.length - newest))
    const last = all.at(-1)

    const forDream = row.entity_type === 'session'
    const gone = forDream ? row.dream === null : row.stay === null

    return [
      {
        id: row.id,
        event_id: row.event_id,
        burn: row.burn,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        title: forDream ? row.title : (row.subject_name ?? row.title),
        link: linkTo(row, forDream, gone),
        introduction: forDream ? null : excerptOf(row.introduction),
        gone,
        entry_count: counts?.get(id) ?? all.length,
        last_at: last?.created_at ?? null,
        entries: shown,
      } satisfies Thread,
    ]
  })
}

const linkTo = (
  row: { event_id: string; entity_id: string; subject: string | null },
  forDream: boolean,
  gone: boolean,
): string | null => {
  if (forDream) return gone ? null : dreamPage(row.event_id, row.entity_id)

  return row.subject === null ? null : profilePage(row.subject)
}

export const subjectOf = async (
  db: Database,
  attendanceId: string,
): Promise<{ account_id: string; name: string | null } | undefined> => {
  const [row] = await db
    .select({ account_id: attendance.account_id, name: account.name })
    .from(attendance)
    .innerJoin(account, eq(account.id, attendance.account_id))
    .where(eq(attendance.id, attendanceId))
    .limit(1)

  return row
}

export const participantsOf = async (
  db: Database,
  found: { id: string; entity_type: ThreadEntityType; entity_id: string },
): Promise<Set<string>> => {
  const spoke = await db
    .selectDistinct({ account_id: threadEntry.author_account_id })
    .from(threadEntry)
    .where(and(eq(threadEntry.thread_id, found.id), inArray(threadEntry.kind, ['comment', 'offered'])))

  const people = new Set(spoke.flatMap((row) => (row.account_id === null ? [] : [row.account_id])))

  if (found.entity_type === 'attendance') {
    const subject = await subjectOf(db, found.entity_id)
    if (subject !== undefined) people.add(subject.account_id)

    return people
  }

  const facilitating = await db
    .select({ account_id: attendance.account_id })
    .from(session)
    .innerJoin(attendance, eq(attendance.id, session.facilitator_attendance_id))
    .where(eq(session.id, found.entity_id))

  const helping = await db
    .select({ account_id: attendance.account_id })
    .from(sessionHelper)
    .innerJoin(attendance, eq(attendance.id, sessionHelper.attendance_id))
    .where(eq(sessionHelper.session_id, found.entity_id))

  for (const row of [...facilitating, ...helping]) people.add(row.account_id)

  return people
}

export interface ThreadDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

export const registerThreadRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: ThreadDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { id: string } }>(
    apiRoutes.getThread.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const [found] = await readThreads(db, [request.params.id])
      if (found === undefined) return sendError(reply, 404)

      return { thread: found } satisfies ThreadResponse
    },
  )

  app.post<{ Params: { id: string } }>(
    apiRoutes.postComment.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(commentSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const [found] = await db
        .select({
          id: thread.id,
          event_id: thread.event_id,
          entity_type: thread.entity_type,
          entity_id: thread.entity_id,
          title: thread.title,
        })
        .from(thread)
        .where(eq(thread.id, request.params.id))
        .limit(1)

      if (found === undefined) return sendError(reply, 404)

      await addEntry(
        db,
        { thread_id: found.id, kind: 'comment', author_account_id: viewer.account_id, body: body.body },
        now(),
      )

      await tellAbout(found, viewer.account_id)

      return await whole(reply, found.id)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateComment.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(commentSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const [comment] = await db
        .select({ id: threadEntry.id, thread_id: threadEntry.thread_id })
        .from(threadEntry)
        .where(
          and(
            eq(threadEntry.id, request.params.id),
            eq(threadEntry.kind, 'comment'),
            eq(threadEntry.author_account_id, viewer.account_id),
          ),
        )
        .limit(1)

      if (comment === undefined) return sendError(reply, 404)

      await db
        .update(threadEntry)
        .set({ body: body.body, edited_at: now().toISOString() })
        .where(eq(threadEntry.id, comment.id))

      return await whole(reply, comment.thread_id)
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteComment.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const [comment] = await db
        .select({
          id: threadEntry.id,
          thread_id: threadEntry.thread_id,
          author_account_id: threadEntry.author_account_id,
        })
        .from(threadEntry)
        .where(and(eq(threadEntry.id, request.params.id), eq(threadEntry.kind, 'comment')))
        .limit(1)

      if (comment === undefined) return sendError(reply, 404)
      if (comment.author_account_id !== viewer.account_id && !viewer.roles.includes('admin')) {
        return sendError(reply, 404)
      }

      await db.delete(threadEntry).where(eq(threadEntry.id, comment.id))

      return await whole(reply, comment.thread_id)
    },
  )

  const whole = async (reply: FastifyReply, threadId: string) => {
    const [found] = await readThreads(db, [threadId])
    if (found === undefined) return sendError(reply, 404)

    return { thread: found } satisfies ThreadResponse
  }

  const aboutWhat = async (found: {
    event_id: string
    entity_type: ThreadEntityType
    entity_id: string
    title: string
  }): Promise<{ link: string | null; what: string }> => {
    if (found.entity_type === 'session') {
      return { link: dreamPage(found.event_id, found.entity_id), what: found.title }
    }

    const subject = await subjectOf(db, found.entity_id)

    return subject === undefined
      ? { link: null, what: found.title }
      : { link: profilePage(subject.account_id), what: subject.name ?? found.title }
  }

  const tellAbout = async (
    found: { id: string; event_id: string; entity_type: ThreadEntityType; entity_id: string; title: string },
    author: string,
  ) => {
    const { link, what } = await aboutWhat(found)
    const said = `${await displayName(db, author)} said something about ${what}`
    const mine = found.entity_type === 'session' ? 'dream_comment' : 'introduction_comment'
    const anybody = found.entity_type === 'session' ? 'dream_comment_any' : 'introduction_comment_any'

    const people = await participantsOf(db, found)
    people.delete(author)

    const attendees = await db
      .select({ account_id: attendance.account_id })
      .from(attendance)
      .where(and(eq(attendance.event_id, found.event_id), ne(attendance.account_id, author)))

    await Promise.all([
      ...[...people].map(async (accountId) => await notify(accountId, { category: mine, body: said, link })),
      ...attendees
        .filter((row) => !people.has(row.account_id))
        .map(async (row) => await notify(row.account_id, { category: anybody, body: said, link })),
    ])
  }
}
