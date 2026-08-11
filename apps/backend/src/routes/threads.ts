import type {
  NotificationCategory,
  Supporter,
  Thread,
  ThreadEntityType,
  ThreadEntry,
  ThreadEntryKind,
  ThreadResponse,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  coalesces,
  commentSchema,
  dreamPage,
  feedPage,
  followSchema,
  mentionedAccounts,
  profilePage,
  songPage,
  withMentionNames,
} from '@sage-burner/shared'
import { and, asc, count, desc, eq, inArray, lte, max, ne, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database, Transaction } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import {
  account,
  accountAvatar,
  attendance,
  event,
  post,
  session,
  sessionHelper,
  sessionSupport,
  song,
  thread,
  threadEntry,
  threadFollow,
  threadSupport,
} from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { approvedAccounts, displayName, namedBy, wants } from '../push/notify.ts'

export interface NewEntry {
  thread_id: string
  kind: ThreadEntryKind
  author_account_id: string | null
  body: string
}

export const threadIdFor = (
  tx: Database | Transaction,
  entity: {
    type: ThreadEntityType
    id: string
    event_id: string | null
    title: string
    subject_account_id?: string
  },
): string => {
  const [made] = tx
    .insert(thread)
    .values({
      id: randomUUID(),
      event_id: entity.event_id,
      entity_type: entity.type,
      entity_id: entity.id,
      subject_account_id: entity.subject_account_id ?? null,
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

export type Written = 'coalesced' | 'inserted'

export const addEntry = async (db: Database, entry: NewEntry, at: Date): Promise<Written> => {
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

      return 'coalesced'
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

  return 'inserted'
}

export const threadFor = async (
  db: Database,
  type: ThreadEntityType,
  entity: { id: string; event_id: string | null; title: string },
): Promise<string> => {
  const [row] = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.entity_type, type), eq(thread.entity_id, entity.id)))
    .limit(1)

  return row?.id ?? threadIdFor(db, { type, ...entity })
}

export const cardFor = async (
  db: Database,
  stay: { id: string; event_id: string },
  subject: { account_id: string; name: string },
): Promise<string> => {
  const [held] = await db
    .select({ id: thread.id, entity_id: thread.entity_id })
    .from(thread)
    .where(
      and(
        eq(thread.entity_type, 'attendance'),
        eq(thread.subject_account_id, subject.account_id),
        eq(thread.event_id, stay.event_id),
      ),
    )
    .limit(1)

  if (held === undefined) {
    return threadIdFor(db, {
      type: 'attendance',
      id: stay.id,
      event_id: stay.event_id,
      title: subject.name,
      subject_account_id: subject.account_id,
    })
  }

  if (held.entity_id !== stay.id) {
    await db.update(thread).set({ entity_id: stay.id }).where(eq(thread.id, held.id))
  }

  return held.id
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
): Promise<Written> => {
  const id = await cardFor(db, stay, who)

  return await addEntry(db, { thread_id: id, kind, author_account_id: who.account_id, body }, at)
}

export const recentThreads = async (
  db: Database,
  limit: number,
  entities: readonly ThreadEntityType[],
): Promise<{ id: string; last_at: string; entry_count: number }[]> => {
  const rows = await db
    .select({
      id: threadEntry.thread_id,
      last_at: max(threadEntry.created_at),
      entry_count: count(),
    })
    .from(threadEntry)
    .innerJoin(thread, eq(thread.id, threadEntry.thread_id))
    .where(inArray(thread.entity_type, [...entities]))
    .groupBy(threadEntry.thread_id)
    .orderBy(desc(max(threadEntry.created_at)), desc(threadEntry.thread_id))
    .limit(limit)

  return rows.flatMap((row) =>
    row.last_at === null ? [] : [{ id: row.id, last_at: row.last_at, entry_count: row.entry_count }],
  )
}

type Hearts = ReadonlyMap<string, Supporter[]>

const heartsFor = async (db: Database, ids: readonly string[]): Promise<Hearts> => {
  const rows = await db
    .select({
      thread_id: threadSupport.thread_id,
      account_id: account.id,
      name: account.name,
      avatar: accountAvatar.updated_at,
    })
    .from(threadSupport)
    .innerJoin(account, eq(account.id, threadSupport.account_id))
    .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
    .where(inArray(threadSupport.thread_id, [...ids]))
    .orderBy(asc(account.name), asc(account.id))

  const dreams = await db
    .select({
      thread_id: thread.id,
      account_id: account.id,
      name: account.name,
      avatar: accountAvatar.updated_at,
    })
    .from(thread)
    .innerJoin(sessionSupport, eq(sessionSupport.session_id, thread.entity_id))
    .innerJoin(attendance, eq(attendance.id, sessionSupport.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
    .where(and(inArray(thread.id, [...ids]), eq(thread.entity_type, 'session')))
    .orderBy(asc(account.name), asc(account.id))

  const held = new Map<string, Supporter[]>()
  for (const row of [...rows, ...dreams]) {
    held.set(row.thread_id, [
      ...(held.get(row.thread_id) ?? []),
      { account_id: row.account_id, name: row.name, avatar: row.avatar },
    ])
  }

  return held
}

const participantThreads = async (
  db: Database,
  ids: readonly string[],
  viewer: { account_id: string } | undefined,
): Promise<ReadonlySet<string>> => {
  if (viewer === undefined) return new Set()

  const spoke = await db
    .selectDistinct({ thread_id: threadEntry.thread_id })
    .from(threadEntry)
    .where(
      and(
        inArray(threadEntry.thread_id, [...ids]),
        eq(threadEntry.author_account_id, viewer.account_id),
        inArray(threadEntry.kind, ['comment', 'offered']),
      ),
    )

  const facilitating = await db
    .select({ thread_id: thread.id })
    .from(thread)
    .innerJoin(session, and(eq(thread.entity_type, 'session'), eq(session.id, thread.entity_id)))
    .innerJoin(attendance, eq(attendance.id, session.facilitator_attendance_id))
    .where(and(inArray(thread.id, [...ids]), eq(attendance.account_id, viewer.account_id)))

  const helping = await db
    .select({ thread_id: thread.id })
    .from(thread)
    .innerJoin(sessionHelper, eq(sessionHelper.session_id, thread.entity_id))
    .innerJoin(attendance, eq(attendance.id, sessionHelper.attendance_id))
    .where(
      and(
        inArray(thread.id, [...ids]),
        eq(thread.entity_type, 'session'),
        eq(attendance.account_id, viewer.account_id),
      ),
    )

  return new Set([...spoke, ...facilitating, ...helping].map((row) => row.thread_id))
}

const partOf = (row: CardRow, already: ReadonlySet<string>, viewer: Viewer): boolean =>
  viewer !== undefined &&
  (already.has(row.id) ||
    row.subject === viewer.account_id ||
    row.post_author === viewer.account_id ||
    row.song_author === viewer.account_id)

const followsFor = async (
  db: Database,
  ids: readonly string[],
  viewer: { account_id: string } | undefined,
): Promise<ReadonlyMap<string, boolean>> => {
  if (viewer === undefined) return new Map()

  const rows = await db
    .select({ thread_id: threadFollow.thread_id, enabled: threadFollow.enabled })
    .from(threadFollow)
    .where(and(inArray(threadFollow.thread_id, [...ids]), eq(threadFollow.account_id, viewer.account_id)))

  return new Map(rows.map((row) => [row.thread_id, row.enabled]))
}

export const readThreads = async (
  db: Database,
  ids: readonly string[],
  {
    newest,
    counts,
    viewer,
  }: {
    newest?: number
    counts?: ReadonlyMap<string, number>
    viewer?: { account_id: string }
  } = {},
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
      post_title: post.title,
      post_body: post.body,
      post_withdrawn_at: post.withdrawn_at,
      post_author: post.author_account_id,
      song_title: song.title,
      song_deleted_at: song.deleted_at,
      song_author: song.author_account_id,
    })
    .from(thread)
    .leftJoin(event, eq(event.id, thread.event_id))
    .leftJoin(session, and(eq(thread.entity_type, 'session'), eq(session.id, thread.entity_id)))
    .leftJoin(attendance, and(eq(thread.entity_type, 'attendance'), eq(attendance.id, thread.entity_id)))
    .leftJoin(account, eq(account.id, thread.subject_account_id))
    .leftJoin(post, and(eq(thread.entity_type, 'post'), eq(post.id, thread.entity_id)))
    .leftJoin(song, and(eq(thread.entity_type, 'song'), eq(song.id, thread.entity_id)))
    .where(inArray(thread.id, [...ids]))

  const ranked = db
    .select({
      id: threadEntry.id,
      thread_id: threadEntry.thread_id,
      kind: threadEntry.kind,
      body: threadEntry.body,
      created_at: threadEntry.created_at,
      edited_at: threadEntry.edited_at,
      author_id: threadEntry.author_account_id,
      seq: threadEntry.seq,
      newness:
        sql<number>`row_number() over (partition by ${threadEntry.thread_id} order by ${threadEntry.seq} desc)`.as(
          'newness',
        ),
    })
    .from(threadEntry)
    .where(inArray(threadEntry.thread_id, [...ids]))
    .as('ranked')

  const entries = await db
    .select({
      id: ranked.id,
      thread_id: ranked.thread_id,
      kind: ranked.kind,
      body: ranked.body,
      created_at: ranked.created_at,
      edited_at: ranked.edited_at,
      author_id: ranked.author_id,
      author_name: account.name,
    })
    .from(ranked)
    .leftJoin(account, eq(account.id, ranked.author_id))
    .where(newest === undefined ? undefined : lte(ranked.newness, newest))
    .orderBy(asc(ranked.thread_id), asc(ranked.seq))

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
  const hearts = await heartsFor(db, ids)
  const said = await followsFor(db, ids, viewer)
  const already = await participantThreads(db, ids, viewer)

  const namesById = await mentionedNames(db, [
    ...entries.map((row) => row.body),
    ...rows.flatMap((row) => [row.post_body ?? '', row.introduction ?? '']),
  ])
  const named = (body: string) => withMentionNames(body, (target) => namesById.get(target))

  return ids.flatMap((id) => {
    const row = byId.get(id)
    if (row === undefined) return []

    const shown = (held.get(id) ?? []).map((entry) => ({ ...entry, body: named(entry.body) }))
    const last = shown.at(-1)

    return [
      {
        id: row.id,
        event_id: row.event_id,
        burn: row.burn,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        ...withNamedBody(factsFor(row), named),
        own: authoredBy(row, viewer),
        entry_count: counts?.get(id) ?? shown.length,
        last_at: last?.created_at ?? null,
        entries: shown,
        supporters: hearts.get(id) ?? [],
        support_count: (hearts.get(id) ?? []).length,
        supported_by_me: (hearts.get(id) ?? []).some((person) => person.account_id === viewer?.account_id),
        followed_by_me: said.get(id) ?? partOf(row, already, viewer),
      } satisfies Thread,
    ]
  })
}

type Viewer = { account_id: string } | undefined

const authoredBy = (row: CardRow, viewer: Viewer): boolean =>
  viewer !== undefined &&
  (row.entity_type === 'post'
    ? row.post_author === viewer.account_id
    : row.entity_type === 'song' && row.song_author === viewer.account_id)

interface CardRow {
  id: string
  event_id: string | null
  entity_type: ThreadEntityType
  entity_id: string
  title: string
  dream: string | null
  stay: string | null
  subject: string | null
  subject_name: string | null
  introduction: string | null
  post_title: string | null
  post_body: string | null
  post_withdrawn_at: string | null
  post_author: string | null
  song_title: string | null
  song_deleted_at: string | null
  song_author: string | null
}

type CardFacts = Pick<Thread, 'title' | 'link' | 'body' | 'gone'>

const written = (body: string | null): string | null => (body?.trim() === '' ? null : body)

const dreamFacts = (row: CardRow): CardFacts => ({
  title: row.title,
  link: row.dream === null || row.event_id === null ? null : dreamPage(row.event_id, row.entity_id),
  body: null,
  gone: row.dream === null,
})

const personFacts = (row: CardRow): CardFacts => ({
  title: row.subject_name ?? row.title,
  link: row.subject === null ? null : profilePage(row.subject),
  body: written(row.introduction),
  gone: row.stay === null,
})

const postFacts = (row: CardRow): CardFacts => ({
  title: row.post_title ?? row.title,
  link: null,
  body: row.post_withdrawn_at === null ? written(row.post_body) : null,
  gone: row.post_withdrawn_at !== null,
})

const songFacts = (row: CardRow): CardFacts => ({
  title: row.song_title ?? row.title,
  link: row.song_title === null ? null : songPage(row.entity_id),
  body: null,
  gone: row.song_title === null || row.song_deleted_at !== null,
})

const withNamedBody = (facts: CardFacts, named: (body: string) => string): CardFacts =>
  facts.body === null ? facts : { ...facts, body: named(facts.body) }

export const mentionedNames = async (
  db: Database,
  bodies: readonly string[],
): Promise<Map<string, string>> => {
  const wanted = [...new Set(bodies.flatMap((body) => mentionedAccounts(body)))]
  if (wanted.length === 0) return new Map()

  const rows = await db
    .select({ id: account.id, name: account.name })
    .from(account)
    .where(inArray(account.id, wanted))

  return new Map(rows.flatMap((row) => (row.name === null ? [] : [[row.id, row.name] as const])))
}

const factsFor = (row: CardRow): CardFacts =>
  ({ session: dreamFacts, attendance: personFacts, post: postFacts, song: songFacts })[row.entity_type](row)

export const nameOf = async (db: Database, accountId: string): Promise<string | null> => {
  const [row] = await db
    .select({ name: account.name })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)

  return row?.name ?? null
}

const saidAbout = async (db: Database, threadId: string, enabled: boolean): Promise<string[]> => {
  const rows = await db
    .select({ account_id: threadFollow.account_id })
    .from(threadFollow)
    .where(and(eq(threadFollow.thread_id, threadId), eq(threadFollow.enabled, enabled)))

  return rows.map((row) => row.account_id)
}

export const following = async (db: Database, threadId: string): Promise<string[]> =>
  await saidAbout(db, threadId, true)

export const muting = async (db: Database, threadId: string): Promise<string[]> =>
  await saidAbout(db, threadId, false)

export const participantsOf = async (
  db: Database,
  found: {
    id: string
    entity_type: ThreadEntityType
    entity_id: string
    subject_account_id: string | null
  },
): Promise<Set<string>> => {
  const spoke = await db
    .selectDistinct({ account_id: threadEntry.author_account_id })
    .from(threadEntry)
    .where(and(eq(threadEntry.thread_id, found.id), inArray(threadEntry.kind, ['comment', 'offered'])))

  const people = new Set(spoke.flatMap((row) => (row.account_id === null ? [] : [row.account_id])))

  if (found.entity_type === 'attendance') {
    if (found.subject_account_id !== null) people.add(found.subject_account_id)

    return people
  }

  if (found.entity_type === 'post') {
    const [row] = await db
      .select({ author: post.author_account_id })
      .from(post)
      .where(eq(post.id, found.entity_id))
      .limit(1)
    if (row?.author != null) people.add(row.author)

    return people
  }

  if (found.entity_type === 'song') {
    const [row] = await db
      .select({ author: song.author_account_id })
      .from(song)
      .where(eq(song.id, found.entity_id))
      .limit(1)
    if (row?.author != null) people.add(row.author)

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

      const viewer = await viewerFor(request, { db, sessions })
      const [found] = await readThreads(db, [request.params.id], { viewer })
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
          subject_account_id: thread.subject_account_id,
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

      await tellAbout(found, viewer.account_id, body.body)

      return await whole(reply, found.id, viewer)
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
        .select({ id: threadEntry.id, thread_id: threadEntry.thread_id, body: threadEntry.body })
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

      const [on] = await db
        .select({
          event_id: thread.event_id,
          entity_type: thread.entity_type,
          entity_id: thread.entity_id,
          subject_account_id: thread.subject_account_id,
          title: thread.title,
        })
        .from(thread)
        .where(eq(thread.id, comment.thread_id))
        .limit(1)

      if (on !== undefined) {
        await tellNewlyNamed(on, viewer.account_id, comment.body, body.body)
      }

      return await whole(reply, comment.thread_id, viewer)
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

      return await whole(reply, comment.thread_id, viewer)
    },
  )

  const heart = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    put: boolean,
  ) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [found] = await db
      .select({
        id: thread.id,
        event_id: thread.event_id,
        entity_type: thread.entity_type,
        entity_id: thread.entity_id,
      })
      .from(thread)
      .where(eq(thread.id, request.params.id))
      .limit(1)

    if (found === undefined) return sendError(reply, 404)

    if (found.entity_type === 'session') {
      // `thread.entity_id` deliberately carries no foreign key, so a withdrawn dream's card
      // outlives the row — but `session_support.session_id` does, so hearting one would be a
      // dangling insert and a 500 rather than a refusal.
      const [dream] = await db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, found.entity_id))
        .limit(1)

      if (dream === undefined) return sendError(reply, 404)

      const mine =
        found.event_id === null ? undefined : await attendanceFor(db, found.event_id, viewer.account_id)
      if (mine === undefined) return sendError(reply, 403)

      if (put) {
        await db
          .insert(sessionSupport)
          .values({ session_id: found.entity_id, attendance_id: mine })
          .onConflictDoNothing()
      } else {
        await db
          .delete(sessionSupport)
          .where(and(eq(sessionSupport.session_id, found.entity_id), eq(sessionSupport.attendance_id, mine)))
      }
    } else if (put) {
      await db
        .insert(threadSupport)
        .values({ thread_id: found.id, account_id: viewer.account_id })
        .onConflictDoNothing()
    } else {
      await db
        .delete(threadSupport)
        .where(and(eq(threadSupport.thread_id, found.id), eq(threadSupport.account_id, viewer.account_id)))
    }

    return await whole(reply, found.id, viewer)
  }

  app.put<{ Params: { id: string } }>(
    apiRoutes.setThreadFollow.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(followSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const [found] = await db
        .select({ id: thread.id })
        .from(thread)
        .where(eq(thread.id, request.params.id))
        .limit(1)

      if (found === undefined) return sendError(reply, 404)

      await db
        .insert(threadFollow)
        .values({ thread_id: found.id, account_id: viewer.account_id, enabled: body.following })
        .onConflictDoUpdate({
          target: [threadFollow.thread_id, threadFollow.account_id],
          set: { enabled: body.following },
        })

      return await whole(reply, found.id, viewer)
    },
  )

  app.post<{ Params: { id: string } }>(
    apiRoutes.supportThread.fastify,
    { preHandler: requireApproved },
    async (request, reply) => await heart(request, reply, true),
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSupportForThread.fastify,
    { preHandler: requireApproved },
    async (request, reply) => await heart(request, reply, false),
  )

  const whole = async (reply: FastifyReply, threadId: string, viewer?: Viewer) => {
    const [found] = await readThreads(db, [threadId], { viewer })
    if (found === undefined) return sendError(reply, 404)

    return { thread: found } satisfies ThreadResponse
  }

  const aboutWhat = async (found: {
    event_id: string | null
    entity_type: ThreadEntityType
    entity_id: string
    subject_account_id: string | null
    title: string
  }): Promise<{ link: string | null; what: string }> => {
    if (found.entity_type === 'session') {
      return {
        link: found.event_id === null ? null : dreamPage(found.event_id, found.entity_id),
        what: found.title,
      }
    }

    if (found.entity_type === 'song') {
      const [row] = await db
        .select({ title: song.title })
        .from(song)
        .where(eq(song.id, found.entity_id))
        .limit(1)

      return { link: songPage(found.entity_id), what: row?.title ?? found.title }
    }

    if (found.entity_type === 'post') {
      const [row] = await db
        .select({ title: post.title })
        .from(post)
        .where(eq(post.id, found.entity_id))
        .limit(1)

      return { link: feedPage(), what: row?.title ?? found.title }
    }

    const subject = found.subject_account_id
    if (subject === null) return { link: null, what: found.title }

    return { link: profilePage(subject), what: (await nameOf(db, subject)) ?? found.title }
  }

  const commentCategories = {
    session: { mine: 'dream_comment', anybody: 'dream_comment_any' },
    attendance: { mine: 'introduction_comment', anybody: 'introduction_comment_any' },
    post: { mine: 'post_comment', anybody: 'post_comment_any' },
    song: { mine: 'song_comment', anybody: 'song_comment_any' },
  } as const satisfies Record<ThreadEntityType, { mine: NotificationCategory; anybody: NotificationCategory }>

  // Being named displaces the ordinary category, so it may only displace it for somebody the
  // mention actually reaches — otherwise switching `mentioned` off silences what they did ask for.
  const reaching = async (database: Database, named: readonly string[]): Promise<string[]> => {
    const asked = await Promise.all(
      named.map(async (accountId) => {
        const channels = await wants(database, accountId, 'mentioned')

        return channels.bell || channels.email ? [accountId] : []
      }),
    )

    return asked.flat()
  }

  const tellNamed = async (named: readonly string[], who: string, what: string, link: string | null) => {
    const said = `${who} named you in ${what}`

    await Promise.all(
      named.map(async (accountId) => await notify(accountId, { category: 'mentioned', body: said, link })),
    )
  }

  // Whom "anybody commented" reaches: the burn's attendance, and every approved account for a
  // thread that belongs to no burn — #259's rule read for something global.
  const audienceFor = async (eventId: string | null, author: string): Promise<string[]> =>
    eventId === null
      ? (await approvedAccounts(db)).filter((accountId) => accountId !== author)
      : (
          await db
            .select({ account_id: attendance.account_id })
            .from(attendance)
            .where(and(eq(attendance.event_id, eventId), ne(attendance.account_id, author)))
        ).map((row) => row.account_id)

  const tellAbout = async (
    found: {
      id: string
      event_id: string | null
      entity_type: ThreadEntityType
      entity_id: string
      subject_account_id: string | null
      title: string
    },
    author: string,
    body: string,
  ) => {
    const { link, what } = await aboutWhat(found)
    const who = await displayName(db, author)
    const said = `${who} said something about ${what}`
    const { mine, anybody } = commentCategories[found.entity_type]

    const named = await reaching(db, await namedBy(db, body, found.event_id, author))
    const told = new Set(named)

    const people = await participantsOf(db, found)
    for (const accountId of await following(db, found.id)) people.add(accountId)
    for (const accountId of await muting(db, found.id)) people.delete(accountId)
    people.delete(author)

    const listening = await audienceFor(found.event_id, author)

    await Promise.all([
      tellNamed(named, who, what, link),
      ...[...people]
        .filter((accountId) => !told.has(accountId))
        .map(async (accountId) => await notify(accountId, { category: mine, body: said, link })),
      ...listening
        .filter((accountId) => !people.has(accountId) && !told.has(accountId))
        .map(async (accountId) => await notify(accountId, { category: anybody, body: said, link })),
    ])
  }

  const tellNewlyNamed = async (
    found: {
      event_id: string | null
      entity_type: ThreadEntityType
      entity_id: string
      subject_account_id: string | null
      title: string
    },
    author: string,
    before: string,
    after: string,
  ) => {
    const named = await reaching(db, await namedBy(db, after, found.event_id, author))
    const already = new Set(await namedBy(db, before, found.event_id, author))
    const newly = named.filter((accountId) => !already.has(accountId))
    if (newly.length === 0) return

    const { link, what } = await aboutWhat(found)

    await tellNamed(newly, await displayName(db, author), what, link)
  }
}
