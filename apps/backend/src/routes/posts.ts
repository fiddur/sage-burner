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
import { event, post, thread } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { openEventNow, todayIso } from './events.ts'
import { addEntry, threadIdFor } from './threads.ts'

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

export const threadForPost = async (db: Database, announced: Post): Promise<string> => {
  const [row] = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.entity_type, 'post'), eq(thread.entity_id, announced.id)))
    .limit(1)

  return (
    row?.id ??
    threadIdFor(db, {
      type: 'post',
      id: announced.id,
      event_id: announced.event_id,
      title: announced.title,
    })
  )
}

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

    await tellAttendees(
      db,
      notify,
      event_id,
      {
        category: 'post_written',
        body: `${await displayName(db, viewer.account_id)} announced: ${row.title}`,
        link: feedPage(),
      },
      { except: [viewer.account_id] },
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
