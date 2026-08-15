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
  bringPage,
  coalesces,
  commentSchema,
  dreamPage,
  feedPage,
  followSchema,
  mealsPage,
  meetingsPage,
  mentionedAccounts,
  profilePage,
  rolesPage,
  songPage,
  withMentionNames,
} from '@sage-burner/shared'
import { and, asc, count, desc, eq, gt, inArray, lte, max, ne, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database, Transaction } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { handsOn } from '../bring-hands.ts'
import {
  account,
  accountAvatar,
  attendance,
  bringHand,
  bringItem,
  entrySupport,
  event,
  leadRole,
  leadRoleMember,
  meal,
  mealRole,
  meeting,
  meetingPoint,
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
import { approvedAccounts, displayName, namedBy, oneBatch, reachedByMention } from '../push/notify.ts'

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

  openWith(db, entry, at)

  return 'inserted'
}

export const openWith = (tx: Database | Transaction, entry: NewEntry, at: Date) => {
  tx.insert(threadEntry)
    .values({
      id: randomUUID(),
      thread_id: entry.thread_id,
      kind: entry.kind,
      seq: sql`(select coalesce(max(${threadEntry.seq}), 0) + 1 from ${threadEntry} where ${threadEntry.thread_id} = ${entry.thread_id})`,
      author_account_id: entry.author_account_id,
      body: entry.body,
      created_at: at.toISOString(),
      edited_at: null,
    })
    .run()
}

export const forgetThread = (tx: Transaction, type: ThreadEntityType, entityId: string) => {
  tx.delete(thread)
    .where(and(eq(thread.entity_type, type), eq(thread.entity_id, entityId)))
    .run()
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

const heartsOnEntries = async (db: Database, ids: readonly string[]): Promise<Hearts> => {
  if (ids.length === 0) return new Map()

  const rows = await db
    .select({
      entry_id: entrySupport.entry_id,
      account_id: account.id,
      name: account.name,
      avatar: accountAvatar.updated_at,
    })
    .from(entrySupport)
    .innerJoin(account, eq(account.id, entrySupport.account_id))
    .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
    .where(inArray(entrySupport.entry_id, [...ids]))
    .orderBy(asc(account.name), asc(account.id))

  const held = new Map<string, Supporter[]>()
  for (const row of rows) {
    held.set(row.entry_id, [
      ...(held.get(row.entry_id) ?? []),
      { account_id: row.account_id, name: row.name, avatar: row.avatar },
    ])
  }

  return held
}

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

  const bringing = await db
    .select({ thread_id: thread.id })
    .from(thread)
    .innerJoin(bringHand, eq(bringHand.item_id, thread.entity_id))
    .innerJoin(attendance, eq(attendance.id, bringHand.attendance_id))
    .where(
      and(
        inArray(thread.id, [...ids]),
        eq(thread.entity_type, 'bring'),
        eq(attendance.account_id, viewer.account_id),
      ),
    )

  const looking = await db
    .select({ thread_id: thread.id })
    .from(thread)
    .innerJoin(leadRole, eq(leadRole.id, thread.entity_id))
    .innerJoin(attendance, eq(attendance.id, leadRole.lead_attendance_id))
    .where(
      and(
        inArray(thread.id, [...ids]),
        eq(thread.entity_type, 'role'),
        eq(attendance.account_id, viewer.account_id),
      ),
    )

  const onTheTeam = await db
    .select({ thread_id: thread.id })
    .from(thread)
    .innerJoin(leadRoleMember, eq(leadRoleMember.role_id, thread.entity_id))
    .innerJoin(attendance, eq(attendance.id, leadRoleMember.attendance_id))
    .where(
      and(
        inArray(thread.id, [...ids]),
        eq(thread.entity_type, 'role'),
        eq(attendance.account_id, viewer.account_id),
      ),
    )

  const cooking = await db
    .select({ thread_id: thread.id })
    .from(thread)
    .innerJoin(mealRole, eq(mealRole.meal_id, thread.entity_id))
    .innerJoin(attendance, eq(attendance.id, mealRole.attendance_id))
    .where(
      and(
        inArray(thread.id, [...ids]),
        eq(thread.entity_type, 'meal'),
        eq(attendance.account_id, viewer.account_id),
      ),
    )

  return new Set(
    [...spoke, ...facilitating, ...helping, ...bringing, ...looking, ...onTheTeam, ...cooking].map(
      (row) => row.thread_id,
    ),
  )
}

const partOf = (row: CardRow, already: ReadonlySet<string>, viewer: Viewer): boolean =>
  viewer !== undefined &&
  (already.has(row.id) || row.subject === viewer.account_id || authorOf(row) === viewer.account_id)

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
    after,
    counts,
    viewer,
  }: {
    newest?: number
    after?: string | null
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
      bring_title: bringItem.title,
      bring_comment: bringItem.comment,
      bring_withdrawn_at: bringItem.withdrawn_at,
      bring_author: bringItem.author_account_id,
      point_title: meetingPoint.title,
      point_body: meetingPoint.body,
      point_decision: meetingPoint.decision,
      point_author: meetingPoint.author_account_id,
      meeting_title: meeting.title,
      meeting_notes: meeting.notes,
      meeting_starts_at: meeting.starts_at,
      meeting_author: meeting.author_account_id,
      role_title: leadRole.title,
      role_purpose: leadRole.purpose,
      meal_label: meal.label,
      meal_idea: meal.food_idea,
    })
    .from(thread)
    .leftJoin(event, eq(event.id, thread.event_id))
    .leftJoin(session, and(eq(thread.entity_type, 'session'), eq(session.id, thread.entity_id)))
    .leftJoin(attendance, and(eq(thread.entity_type, 'attendance'), eq(attendance.id, thread.entity_id)))
    .leftJoin(account, eq(account.id, thread.subject_account_id))
    .leftJoin(post, and(eq(thread.entity_type, 'post'), eq(post.id, thread.entity_id)))
    .leftJoin(song, and(eq(thread.entity_type, 'song'), eq(song.id, thread.entity_id)))
    .leftJoin(bringItem, and(eq(thread.entity_type, 'bring'), eq(bringItem.id, thread.entity_id)))
    .leftJoin(meetingPoint, and(eq(thread.entity_type, 'point'), eq(meetingPoint.id, thread.entity_id)))
    .leftJoin(meeting, and(eq(thread.entity_type, 'meeting'), eq(meeting.id, thread.entity_id)))
    .leftJoin(leadRole, and(eq(thread.entity_type, 'role'), eq(leadRole.id, thread.entity_id)))
    .leftJoin(meal, and(eq(thread.entity_type, 'meal'), eq(meal.id, thread.entity_id)))
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
    .where(
      and(
        inArray(threadEntry.thread_id, [...ids]),
        after == null ? undefined : gt(threadEntry.created_at, after),
      ),
    )
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

  const loved = await heartsOnEntries(
    db,
    entries.filter((row) => row.kind === 'comment').map((row) => row.id),
  )

  const held = new Map<string, ThreadEntry[]>()
  for (const row of entries) {
    const given = loved.get(row.id) ?? []

    held.set(row.thread_id, [
      ...(held.get(row.thread_id) ?? []),
      {
        id: row.id,
        kind: row.kind,
        author: row.author_id === null ? null : { account_id: row.author_id, name: row.author_name },
        body: row.body,
        created_at: row.created_at,
        edited_at: row.edited_at,
        supporters: given,
        support_count: given.length,
        supported_by_me: given.some((person) => person.account_id === viewer?.account_id),
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

const authorOf = (row: CardRow): string | null => {
  if (row.entity_type === 'post') return row.post_author
  if (row.entity_type === 'song') return row.song_author
  if (row.entity_type === 'bring') return row.bring_author
  if (row.entity_type === 'point') return row.point_author
  if (row.entity_type === 'meeting') return row.meeting_author

  return null
}

const authoredBy = (row: CardRow, viewer: Viewer): boolean =>
  viewer !== undefined && authorOf(row) === viewer.account_id

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
  bring_title: string | null
  bring_comment: string | null
  bring_withdrawn_at: string | null
  bring_author: string | null
  point_title: string | null
  point_body: string | null
  point_decision: string | null
  point_author: string | null
  meeting_title: string | null
  meeting_notes: string | null
  meeting_starts_at: string | null
  meeting_author: string | null
  role_title: string | null
  role_purpose: string | null
  meal_label: string | null
  meal_idea: string | null
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

const bringFacts = (row: CardRow): CardFacts => ({
  title: row.bring_title ?? row.title,
  link: row.bring_title === null || row.event_id === null ? null : bringPage(row.event_id, row.entity_id),
  body: row.bring_withdrawn_at === null ? written(row.bring_comment) : null,
  gone: row.bring_title === null || row.bring_withdrawn_at !== null,
})

const pointFacts = (row: CardRow): CardFacts => ({
  title: row.point_title ?? row.title,
  link: row.point_title === null || row.event_id === null ? null : meetingsPage(row.event_id, row.entity_id),
  body: written(row.point_decision ?? row.point_body),
  gone: row.point_title === null,
})

const meetingFacts = (row: CardRow): CardFacts => ({
  title: row.meeting_title ?? row.title,
  link: row.meeting_title === null || row.event_id === null ? null : meetingsPage(row.event_id),
  body: written(row.meeting_notes),
  gone: row.meeting_title === null,
})

const roleFacts = (row: CardRow): CardFacts => ({
  title: row.role_title ?? row.title,
  link: row.role_title === null || row.event_id === null ? null : rolesPage(row.event_id),
  body: written(row.role_purpose),
  gone: row.role_title === null,
})

const mealFacts = (row: CardRow): CardFacts => ({
  title: row.meal_label ?? row.title,
  link: row.meal_label === null || row.event_id === null ? null : mealsPage(row.event_id),
  body: written(row.meal_idea),
  gone: row.meal_label === null,
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
  ({
    session: dreamFacts,
    attendance: personFacts,
    post: postFacts,
    song: songFacts,
    bring: bringFacts,
    point: pointFacts,
    meeting: meetingFacts,
    role: roleFacts,
    meal: mealFacts,
  })[row.entity_type](row)

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

interface Whose {
  id: string
  entity_type: ThreadEntityType
  entity_id: string
  subject_account_id: string | null
}

const authorRow = async (
  db: Database,
  table: typeof bringItem | typeof meeting | typeof meetingPoint | typeof post | typeof song,
  entityId: string,
): Promise<string[]> => {
  const [row] = await db
    .select({ author: table.author_account_id })
    .from(table)
    .where(eq(table.id, entityId))
    .limit(1)

  return row?.author == null ? [] : [row.author]
}

const alsoInIt = {
  attendance: (_db: Database, found: Whose) =>
    Promise.resolve(found.subject_account_id === null ? [] : [found.subject_account_id]),
  post: async (db: Database, found: Whose) => await authorRow(db, post, found.entity_id),
  song: async (db: Database, found: Whose) => await authorRow(db, song, found.entity_id),
  point: async (db: Database, found: Whose) => await authorRow(db, meetingPoint, found.entity_id),
  meeting: async (db: Database, found: Whose) => await authorRow(db, meeting, found.entity_id),
  bring: async (db: Database, found: Whose) => [
    ...(await authorRow(db, bringItem, found.entity_id)),
    ...(await handsOn(db, found.entity_id)).map((hand) => hand.account_id),
  ],
  session: async (db: Database, found: Whose) => {
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

    return [...facilitating, ...helping].map((row) => row.account_id)
  },
  meal: async (db: Database, found: Whose) => {
    const cooking = await db
      .select({ account_id: attendance.account_id })
      .from(mealRole)
      .innerJoin(attendance, eq(attendance.id, mealRole.attendance_id))
      .where(eq(mealRole.meal_id, found.entity_id))

    return cooking.map((row) => row.account_id)
  },
  role: async (db: Database, found: Whose) => {
    const leading = await db
      .select({ account_id: attendance.account_id })
      .from(leadRole)
      .innerJoin(attendance, eq(attendance.id, leadRole.lead_attendance_id))
      .where(eq(leadRole.id, found.entity_id))

    const team = await db
      .select({ account_id: attendance.account_id })
      .from(leadRoleMember)
      .innerJoin(attendance, eq(attendance.id, leadRoleMember.attendance_id))
      .where(eq(leadRoleMember.role_id, found.entity_id))

    return [...leading, ...team].map((row) => row.account_id)
  },
} as const satisfies Record<
  ThreadEntityType,
  (db: Database, found: Whose) => Promise<string[]> | Promise<readonly string[]>
>

export const participantsOf = async (db: Database, found: Whose): Promise<Set<string>> => {
  const spoke = await db
    .selectDistinct({ account_id: threadEntry.author_account_id })
    .from(threadEntry)
    .where(and(eq(threadEntry.thread_id, found.id), inArray(threadEntry.kind, ['comment', 'offered'])))

  const people = new Set(spoke.flatMap((row) => (row.account_id === null ? [] : [row.account_id])))

  for (const accountId of await alsoInIt[found.entity_type](db, found)) people.add(accountId)

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

  const heartComment = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    put: boolean,
  ) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [comment] = await db
      .select({ id: threadEntry.id, thread_id: threadEntry.thread_id })
      .from(threadEntry)
      .where(and(eq(threadEntry.id, request.params.id), eq(threadEntry.kind, 'comment')))
      .limit(1)

    if (comment === undefined) return sendError(reply, 404)

    if (put) {
      await db
        .insert(entrySupport)
        .values({ entry_id: comment.id, account_id: viewer.account_id })
        .onConflictDoNothing()
    } else {
      await db
        .delete(entrySupport)
        .where(and(eq(entrySupport.entry_id, comment.id), eq(entrySupport.account_id, viewer.account_id)))
    }

    return await whole(reply, comment.thread_id, viewer)
  }

  app.post<{ Params: { id: string } }>(
    apiRoutes.supportComment.fastify,
    { preHandler: requireApproved },
    async (request, reply) => await heartComment(request, reply, true),
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSupportForComment.fastify,
    { preHandler: requireApproved },
    async (request, reply) => await heartComment(request, reply, false),
  )

  const whole = async (reply: FastifyReply, threadId: string, viewer?: Viewer) => {
    const [found] = await readThreads(db, [threadId], { viewer })
    if (found === undefined) return sendError(reply, 404)

    return { thread: found } satisfies ThreadResponse
  }

  interface Subject {
    event_id: string | null
    entity_type: ThreadEntityType
    entity_id: string
    subject_account_id: string | null
    title: string
  }

  const titleOf = async (
    table:
      | typeof bringItem
      | typeof leadRole
      | typeof meeting
      | typeof meetingPoint
      | typeof post
      | typeof song,
    found: Subject,
  ): Promise<string> => {
    const [row] = await db
      .select({ title: table.title })
      .from(table)
      .where(eq(table.id, found.entity_id))
      .limit(1)

    return row?.title ?? found.title
  }

  const atItsBurn = (found: Subject, page: (eventId: string, id: string) => string): string | null =>
    found.event_id === null ? null : page(found.event_id, found.entity_id)

  const whatItIsAbout = {
    session: (found: Subject) => Promise.resolve({ link: atItsBurn(found, dreamPage), what: found.title }),
    song: async (found: Subject) => ({
      link: songPage(found.entity_id),
      what: await titleOf(song, found),
    }),
    post: async (found: Subject) => ({ link: feedPage(), what: await titleOf(post, found) }),
    bring: async (found: Subject) => ({
      link: atItsBurn(found, bringPage),
      what: await titleOf(bringItem, found),
    }),
    point: async (found: Subject) => ({
      link: atItsBurn(found, meetingsPage),
      what: await titleOf(meetingPoint, found),
    }),
    meeting: async (found: Subject) => ({
      link: found.event_id === null ? null : meetingsPage(found.event_id),
      what: await titleOf(meeting, found),
    }),
    attendance: async (found: Subject) => {
      const subject = found.subject_account_id
      if (subject === null) return { link: null, what: found.title }

      return { link: profilePage(subject), what: (await nameOf(db, subject)) ?? found.title }
    },
    role: async (found: Subject) => ({
      link: found.event_id === null ? null : rolesPage(found.event_id),
      what: await titleOf(leadRole, found),
    }),
    meal: async (found: Subject) => {
      const [row] = await db
        .select({ label: meal.label })
        .from(meal)
        .where(eq(meal.id, found.entity_id))
        .limit(1)

      return {
        link: found.event_id === null ? null : mealsPage(found.event_id),
        what: row?.label ?? found.title,
      }
    },
  } as const satisfies Record<
    ThreadEntityType,
    (found: Subject) => Promise<{ link: string | null; what: string }>
  >

  const aboutWhat = async (found: Subject): Promise<{ link: string | null; what: string }> =>
    await whatItIsAbout[found.entity_type](found)

  const commentCategories = {
    session: { mine: 'dream_comment', anybody: 'dream_comment_any' },
    attendance: { mine: 'introduction_comment', anybody: 'introduction_comment_any' },
    post: { mine: 'post_comment', anybody: 'post_comment_any' },
    song: { mine: 'song_comment', anybody: 'song_comment_any' },
    bring: { mine: 'bring_comment', anybody: 'bring_comment_any' },
    point: { mine: 'point_comment', anybody: 'point_comment_any' },
    meeting: { mine: 'meeting_comment', anybody: 'meeting_comment_any' },
    role: { mine: 'lead_role_comment', anybody: 'lead_role_comment_any' },
    meal: { mine: 'meal_comment', anybody: 'meal_comment_any' },
  } as const satisfies Record<ThreadEntityType, { mine: NotificationCategory; anybody: NotificationCategory }>

  const tellNamed = async (named: readonly string[], who: string, what: string, link: string | null) => {
    const said = oneBatch({ category: 'mentioned', body: `${who} named you in ${what}`, link })

    await Promise.all(named.map(async (accountId) => await notify(accountId, said)))
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

    const named = await reachedByMention(db, await namedBy(db, body, found.event_id, author))
    const told = new Set(named)

    const muted = new Set(await muting(db, found.id))

    const people = await participantsOf(db, found)
    for (const accountId of await following(db, found.id)) people.add(accountId)
    for (const accountId of muted) people.delete(accountId)
    people.delete(author)

    const listening = (await audienceFor(found.event_id, author)).filter((accountId) => !muted.has(accountId))

    const toTheirOwn = oneBatch({ category: mine, body: said, link })
    const toAnybodyListening = oneBatch({ category: anybody, body: said, link })

    await Promise.all([
      tellNamed(named, who, what, link),
      ...[...people]
        .filter((accountId) => !told.has(accountId))
        .map(async (accountId) => await notify(accountId, toTheirOwn)),
      ...listening
        .filter((accountId) => !people.has(accountId) && !told.has(accountId))
        .map(async (accountId) => await notify(accountId, toAnybodyListening)),
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
    const named = await reachedByMention(db, await namedBy(db, after, found.event_id, author))
    const already = new Set(await namedBy(db, before, found.event_id, author))
    const newly = named.filter((accountId) => !already.has(accountId))
    if (newly.length === 0) return

    const { link, what } = await aboutWhat(found)

    await tellNamed(newly, await displayName(db, author), what, link)
  }
}
