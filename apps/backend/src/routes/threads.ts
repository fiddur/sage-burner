import type {
  Thread,
  ThreadEntityType,
  ThreadEntry,
  ThreadEntryKind,
  ThreadResponse,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'

import { apiRoutes, coalesces, commentSchema, dreamPage } from '@sage-burner/shared'
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

/**
 * A conversation about one thing, and the lines on it (#375).
 *
 * The thread is written with the thing it is about and outlives it: withdrawing a dream
 * leaves a line saying so rather than deleting what people said. `docs/the-app.md` has
 * the why; `db/schema.ts` has why `entity_id` deliberately carries no foreign key.
 */

/** What a writer says happened. The wording is the caller's; the name is not. */
export interface NewEntry {
  thread_id: string
  kind: ThreadEntryKind
  /** Whoever did it or wrote it. Null only for a line nobody is behind. */
  author_account_id: string | null
  /**
   * A verb phrase with neither the actor's name nor the thing's title in it — both are
   * resolved when the line is read, so neither can go stale. It has to read with
   * "Somebody" in front, because an erased account leaves exactly that.
   *
   * **No formatted time in it either.** The server does not know the reader's clock, so
   * "moved it to Sat 14:00" written here would be Saturday in UTC. A quiet line saying
   * something moved is what these are for; the dream itself says when.
   */
  body: string
}

/**
 * The thread for a thing, made if this is the first anybody has needed it.
 *
 * Synchronous so it can join the caller's transaction — offering a dream writes both as
 * one. The upsert is what makes it safe to call from anywhere else too: a dream from
 * before #375 has a thread from the migration, and one that somehow does not gets it
 * here rather than losing the line that was about to be written.
 */
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

/** What a thread is called, kept in step by whoever renames the thing it is about. */
export const renameThread = async (db: Database, threadId: string, title: string) => {
  await db.update(thread).set({ title }).where(eq(thread.id, threadId))
}

/**
 * Put a line on a thread — or rewrite the one above it, where that is the kind.
 *
 * Laying out the grid is a drag every few seconds, so `coalesces` says which kinds a
 * second of rewrites rather than repeats: same kind, same person, nothing in between.
 * `edited_at` is left alone by that — it is what makes a comment show as edited, and a
 * quiet line rewriting itself is not something a reader needs told.
 */
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
    // Counted inside the INSERT rather than read first and added to: one statement
    // cannot interleave with another, and two lines from one save would otherwise be
    // able to claim the same place in the conversation.
    seq: sql`(select coalesce(max(${threadEntry.seq}), 0) + 1 from ${threadEntry} where ${threadEntry.thread_id} = ${entry.thread_id})`,
    author_account_id: entry.author_account_id,
    body: entry.body,
    created_at: at.toISOString(),
    edited_at: null,
  })
}

/**
 * The thread about a dream, made if there is not one yet.
 *
 * Every write to a dream goes through here rather than remembering whether the thread
 * exists — one that was offered before #375 has one from the migration, and the upsert
 * is what makes the answer the same either way.
 */
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

/**
 * Which threads have been used most recently, newest first — what the feed sorts on.
 *
 * The count comes from the same grouping rather than a column kept in step, which is
 * `session_support`'s argument: the rows are the rule and the number is derived on
 * every read.
 */
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

/**
 * Threads by id, with their lines and the names on them.
 *
 * `newest` is how many lines each card carries; leaving it out reads the whole
 * conversation, which is what opening one is for. Nothing pages: a thread is one dream's
 * worth of talk among forty-two people, and a page control for that would be machinery
 * against a case nobody has.
 *
 * Ordered by the ids given, so the caller's ordering — the feed's, by recency — survives.
 */
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
      // Left, and null is the whole of what "withdrawn" means here: the conversation
      // stays, the dream does not. Derived rather than stored, so it cannot come to
      // disagree with the dreams page.
      dream: session.id,
    })
    .from(thread)
    .innerJoin(event, eq(event.id, thread.event_id))
    .leftJoin(session, and(eq(thread.entity_type, 'session'), eq(session.id, thread.entity_id)))
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
    // By `seq`, not by the clock: one save can write two lines from one `now()`, and
    // a conversation that reorders itself between two reads reads as a new one.
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
    // The newest few, still in reading order — a card shows the end of the conversation,
    // not the beginning of it.
    const shown = newest === undefined ? all : all.slice(Math.max(0, all.length - newest))
    const last = all.at(-1)

    return [
      {
        id: row.id,
        event_id: row.event_id,
        burn: row.burn,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        title: row.title,
        gone: row.dream === null,
        entry_count: counts?.get(id) ?? all.length,
        last_at: last?.created_at ?? '',
        entries: shown,
      } satisfies Thread,
    ]
  })
}

/**
 * Everybody with a stake in one conversation: who has spoken, and who has a job on it.
 *
 * Spoken is generic and is most of it — saying something is how you ask to hear the
 * answer. The rest is not: appointing somebody puts a line on the thread authored by
 * whoever appointed, so a facilitator who was handed the dream has said nothing and
 * would otherwise never hear a question about it. That half is the entity's own, which
 * is what `entity_type` gains a branch for when meals or rides become commentable.
 */
export const participantsOf = async (
  db: Database,
  found: { id: string; entity_type: ThreadEntityType; entity_id: string },
): Promise<Set<string>> => {
  const spoke = await db
    .selectDistinct({ account_id: threadEntry.author_account_id })
    .from(threadEntry)
    .where(eq(threadEntry.thread_id, found.id))

  const people = new Set(spoke.flatMap((row) => (row.account_id === null ? [] : [row.account_id])))

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
  /**
   * Told when somebody says something on a thread. Optional and swallowing its own
   * failures like everywhere else: a comment must not fail to be written because a push
   * service or a mail server was down.
   */
  notify?: Notifier
}

/**
 * Threads: reading one, saying something, and rewriting or removing what you said.
 *
 * **Not scoped to a burn still open**, which is the one place a member-facing write is
 * not. Talking about a burn is not arranging one — "that was lovely" is a thing somebody
 * posts on the way home — and retention is still the burn's, since a thread cascades with
 * the event. Every write that changes a burn's arrangements stays on `openEvent`.
 *
 * `requireApproved`, like the roster and the dreams themselves: the schedule is the
 * members' to arrange, and so is the talk about it.
 */
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
            // The author's own, and only the author's. An admin may take a comment off
            // but not put words in somebody's mouth — deleting says who did it, an edit
            // would not.
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

      // Somebody else's, and not an admin: a 404 rather than a 403, like every other
      // read of something that is not yours to touch.
      if (comment === undefined) return sendError(reply, 404)
      if (comment.author_account_id !== viewer.account_id && !viewer.roles.includes('admin')) {
        return sendError(reply, 404)
      }

      await db.delete(threadEntry).where(eq(threadEntry.id, comment.id))

      return await whole(reply, comment.thread_id)
    },
  )

  /** The whole conversation back, so a page that just wrote to it needs no second read. */
  const whole = async (reply: FastifyReply, threadId: string) => {
    const [found] = await readThreads(db, [threadId])
    if (found === undefined) return sendError(reply, 404)

    return { thread: found } satisfies ThreadResponse
  }

  /**
   * Who hears about a comment, split the way every pair here is (#259).
   *
   * Whoever is in the conversation gets the one that is on by default; everybody else
   * coming to the burn gets the one that is off until asked for. Disjoint, so nobody is
   * told twice — and never the person who just wrote it, which is #247's rule.
   *
   * **Attendance is the whole audience** for the second half: somebody who has not said
   * they are coming hears nothing about that burn. No `activity` row is written: the
   * entry is the record, and a line beside it would put the same comment on the feed
   * twice.
   */
  const tellAbout = async (
    found: { id: string; event_id: string; entity_type: ThreadEntityType; entity_id: string; title: string },
    author: string,
  ) => {
    const link = dreamPage(found.event_id, found.entity_id)
    const said = `${await displayName(db, author)} said something about ${found.title}`

    const people = await participantsOf(db, found)
    people.delete(author)

    const attendees = await db
      .select({ account_id: attendance.account_id })
      .from(attendance)
      .where(and(eq(attendance.event_id, found.event_id), ne(attendance.account_id, author)))

    await Promise.all([
      ...[...people].map(
        async (accountId) => await notify(accountId, { category: 'dream_comment', body: said, link }),
      ),
      ...attendees
        .filter((row) => !people.has(row.account_id))
        .map(
          async (row) => await notify(row.account_id, { category: 'dream_comment_any', body: said, link }),
        ),
    ])
  }
}
