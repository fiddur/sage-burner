import type { Post, PostResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, feedPage, postCreateSchema, postUpdateSchema } from '@sage-burner/shared'
import { and, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { event, post } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName, namedBy, tellAttendees } from '../push/notify.ts'
import { openEventNow, todayIso } from './events.ts'
import { addEntry, threadFor } from './threads.ts'

export interface PostDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

const openPost = async (db: Database, now: () => Date, id: string): Promise<Post | undefined> => {
  const [row] = await db
    .select()
    .from(post)
    .innerJoin(event, eq(post.event_id, event.id))
    .where(and(eq(post.id, id), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.post
}

const threadForPost = async (db: Database, announced: Post): Promise<string> =>
  await threadFor(db, 'post', announced)

export const registerPostRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: PostDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const guarded = { preHandler: requireApproved }

  app.post<{ Params: { eventId: string } }>(apiRoutes.addPost.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(postCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const event_id = request.params.eventId
    if (!(await openEventNow(db, now, event_id))) return sendError(reply, 404)

    const row = {
      ...body,
      id: randomUUID(),
      event_id,
      author_account_id: viewer.account_id,
      withdrawn_at: null,
      created_at: now().toISOString(),
    } satisfies Post

    await db.insert(post).values(row)

    const threadId = await threadForPost(db, row)
    await addEntry(
      db,
      { thread_id: threadId, kind: 'posted', author_account_id: viewer.account_id, body: 'announced this' },
      now(),
    )

    const who = await displayName(db, viewer.account_id)
    // Being named wins over the announcement itself, so nobody hears twice about one post.
    const named = await namedBy(db, row.body, event_id, viewer.account_id)

    await Promise.all(
      named.map(
        async (accountId) =>
          await notify(accountId, {
            category: 'mentioned',
            body: `${who} named you in: ${row.title}`,
            link: feedPage(),
          }),
      ),
    )

    await tellAttendees(
      db,
      notify,
      event_id,
      { category: 'post_written', body: `${who} announced: ${row.title}`, link: feedPage() },
      { except: [viewer.account_id, ...named] },
    )

    return reply.code(201).send({ post: row } satisfies PostResponse)
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updatePost.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(postUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const existing = await openPost(db, now, request.params.id)
    if (existing === undefined || existing.withdrawn_at !== null) return sendError(reply, 404)
    if (existing.author_account_id !== viewer.account_id) return sendError(reply, 403)
    if (isEmptyPatch(body)) return { post: existing } satisfies PostResponse

    const patched = await patchRow(db, post, eq(post.id, request.params.id), body)
    if (patched.kind !== 'ok') return sendError(reply, 404)

    const already = new Set(await namedBy(db, existing.body, existing.event_id, viewer.account_id))
    const newly = (await namedBy(db, patched.row.body, existing.event_id, viewer.account_id)).filter(
      (accountId) => !already.has(accountId),
    )
    const by = await displayName(db, viewer.account_id)

    await Promise.all(
      newly.map(
        async (accountId) =>
          await notify(accountId, {
            category: 'mentioned',
            body: `${by} named you in: ${patched.row.title}`,
            link: feedPage(),
          }),
      ),
    )

    await addEntry(
      db,
      {
        thread_id: await threadForPost(db, patched.row),
        kind: 'edited',
        author_account_id: viewer.account_id,
        body: 'reworded it',
      },
      now(),
    )

    return { post: patched.row } satisfies PostResponse
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deletePost.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const existing = await openPost(db, now, request.params.id)
    if (existing === undefined) return sendError(reply, 404)

    const mine = existing.author_account_id === viewer.account_id
    if (!mine && !viewer.roles.includes('admin')) return sendError(reply, 403)

    if (existing.withdrawn_at === null) {
      await db.update(post).set({ withdrawn_at: now().toISOString() }).where(eq(post.id, existing.id))

      await addEntry(
        db,
        {
          thread_id: await threadForPost(db, existing),
          kind: 'withdrawn',
          author_account_id: viewer.account_id,
          body: 'took it back',
        },
        now(),
      )
    }

    return reply.code(204).send()
  })
}
