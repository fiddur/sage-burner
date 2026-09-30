import type { CopySourcesResponse, FaqEntry, FaqListResponse, FaqResponse, FaqRow } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  faqCopySchema,
  faqCreateSchema,
  faqPage,
  faqUpdateSchema,
  idOrderSchema,
} from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { account, event, faqEntry, thread } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { displayName, namedBy, oneBatch, reachedByMention, tellAttendees } from '../push/notify.ts'
import { copySourcesFor } from './copy-sources.ts'
import { openEventNow, todayIso } from './events.ts'
import { addEntry, forgetThread, openWith, renameThread, threadFor, threadIdFor } from './threads.ts'

export interface FaqDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

const columns = {
  id: faqEntry.id,
  event_id: faqEntry.event_id,
  question: faqEntry.question,
  answer: faqEntry.answer,
  order: faqEntry.order,
  author_account_id: faqEntry.author_account_id,
  author_name: account.name,
  created_at: faqEntry.created_at,
  thread_id: thread.id,
}

const listing = (db: Database) =>
  db
    .select(columns)
    .from(faqEntry)
    .leftJoin(account, eq(account.id, faqEntry.author_account_id))
    .leftJoin(thread, and(eq(thread.entity_type, 'faq'), eq(thread.entity_id, faqEntry.id)))

export const faqFor = (db: Database, eventId: string): Promise<FaqEntry[]> =>
  listing(db).where(eq(faqEntry.event_id, eventId)).orderBy(asc(faqEntry.order), asc(faqEntry.id))

const oneEntry = async (db: Database, id: string): Promise<FaqEntry | undefined> => {
  const [row] = await listing(db).where(eq(faqEntry.id, id)).limit(1)

  return row
}

const isBlank = (answer: string): boolean => answer.trim() === ''

export const registerFaqRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: FaqDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  const tellNamed = async (named: readonly string[], who: string, row: FaqRow) => {
    const said = oneBatch({
      category: 'mentioned',
      body: `${who} named you about: ${row.question}`,
      link: faqPage(row.event_id, row.id),
    })

    await Promise.all(named.map(async (accountId) => await notify(accountId, said)))
  }

  const questions = async (eventId: string): Promise<FaqListResponse> => ({
    entries: await faqFor(db, eventId),
  })

  const openEntry = async (id: string) => {
    const [row] = await db.select().from(faqEntry).where(eq(faqEntry.id, id)).limit(1)
    if (row === undefined) return undefined

    return (await openEventNow(db, now, row.event_id)) === undefined ? undefined : row
  }

  const noteTheChange = async (existing: FaqRow, updated: FaqRow, by: string) => {
    const reworded = updated.question !== existing.question || updated.answer !== existing.answer
    if (!reworded) return

    const card = await threadFor(db, 'faq', {
      id: updated.id,
      event_id: updated.event_id,
      title: updated.question,
    })

    if (updated.question !== existing.question) await renameThread(db, card, updated.question)

    const who = await displayName(db, by)
    const already = new Set(await namedBy(db, existing.answer, existing.event_id, by))
    const newly = (
      await reachedByMention(db, await namedBy(db, updated.answer, existing.event_id, by))
    ).filter((accountId) => !already.has(accountId))

    await tellNamed(newly, who, updated)

    if (!isBlank(existing.answer) || isBlank(updated.answer)) {
      await addEntry(
        db,
        { thread_id: card, kind: 'edited', author_account_id: by, body: 'went over it' },
        now(),
      )

      return
    }

    await addEntry(
      db,
      { thread_id: card, kind: 'answered', author_account_id: by, body: 'answered this' },
      now(),
    )

    const asker = existing.author_account_id
    if (asker === null || asker === by || newly.includes(asker)) return

    await notify(asker, {
      category: 'faq_answered',
      body: `${who} answered: ${updated.question}`,
      link: faqPage(updated.event_id, updated.id),
    })
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getFaq.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      return withVersion(reply, await questions(request.params.eventId))
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addFaqEntry.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(faqCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const { eventId } = request.params
      if ((await openEventNow(db, now, eventId)) === undefined) return sendError(reply, 404)

      const id = randomUUID()
      const at = now()

      db.transaction((tx) => {
        const next = nextOrder(tx, faqEntry, eq(faqEntry.event_id, eventId))
        tx.insert(faqEntry)
          .values({
            ...body,
            id,
            event_id: eventId,
            order: next,
            author_account_id: viewer.account_id,
            created_at: at.toISOString(),
          })
          .run()

        const card = threadIdFor(tx, { type: 'faq', id, event_id: eventId, title: body.question })

        openWith(
          tx,
          { thread_id: card, kind: 'asked', author_account_id: viewer.account_id, body: 'asked this' },
          at,
        )
      })

      await tellAttendees(
        db,
        notify,
        eventId,
        {
          category: 'faq_asked',
          body: `${await displayName(db, viewer.account_id)} asks: ${body.question}`,
          link: faqPage(eventId, id),
        },
        { except: [viewer.account_id] },
      )

      const entry = await oneEntry(db, id)
      if (entry === undefined) return sendError(reply, 404)

      return reply.code(201).send({ entry } satisfies FaqResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateFaqEntry.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(faqUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const existing = await openEntry(request.params.id)
      if (existing === undefined) return sendError(reply, 404)
      if (Object.keys(body).length === 0) {
        const entry = await oneEntry(db, existing.id)
        if (entry === undefined) return sendError(reply, 404)

        return { entry } satisfies FaqResponse
      }

      if (await refuseIfStale(request, reply, () => questions(existing.event_id))) return reply

      const [updated] = await db
        .update(faqEntry)
        .set(body)
        .where(eq(faqEntry.id, request.params.id))
        .returning()
      if (updated === undefined) return sendError(reply, 404)

      await noteTheChange(existing, updated, viewer.account_id)

      const entry = await oneEntry(db, updated.id)
      if (entry === undefined) return sendError(reply, 404)

      return await withCollectionVersion(reply, { entry } satisfies FaqResponse, () =>
        questions(existing.event_id),
      )
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteFaqEntry.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const existing = await openEntry(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      if (await refuseIfStale(request, reply, () => questions(existing.event_id))) return reply

      db.transaction((tx) => {
        tx.delete(faqEntry).where(eq(faqEntry.id, existing.id)).run()
        forgetThread(tx, 'faq', existing.id)
      })

      return reply.code(204).send()
    },
  )

  app.put<{ Params: { eventId: string } }>(
    apiRoutes.reorderFaq.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(idOrderSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const { eventId } = request.params
      if ((await openEventNow(db, now, eventId)) === undefined) return sendError(reply, 404)

      if (await refuseIfStale(request, reply, () => questions(eventId))) return reply

      const renumbered = reorder(
        db,
        faqEntry,
        await faqFor(db, eventId),
        body.ids,
        eq(faqEntry.event_id, eventId),
      )
      if (renumbered === 'mismatch') return sendError(reply, 400)

      return withVersion(reply, await questions(eventId))
    },
  )

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getFaqSources.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const sources = await copySourcesFor(
        db,
        { table: faqEntry, eventColumn: faqEntry.event_id, idColumn: faqEntry.id },
        request.params.eventId,
      )

      return { sources } satisfies CopySourcesResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.copyFaq.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(faqCopySchema, request)
      if (body === undefined) return sendError(reply, 400)
      if (body.from_event_id === request.params.eventId) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const at = now()
      const created_at = at.toISOString()
      const today = todayIso(now)
      const seeded = db.transaction((tx) => {
        const [burn] = tx
          .select({ id: event.id })
          .from(event)
          .where(and(eq(event.id, request.params.eventId), gte(event.end_date, today)))
          .limit(1)
          .all()

        if (burn === undefined) return 'not_found' as const

        const [from] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, body.from_event_id))
          .limit(1)
          .all()

        if (from === undefined) return 'not_found' as const

        const [already] = tx
          .select({ id: faqEntry.id })
          .from(faqEntry)
          .where(eq(faqEntry.event_id, request.params.eventId))
          .limit(1)
          .all()

        if (already !== undefined) return 'conflict' as const

        const source = tx
          .select()
          .from(faqEntry)
          .where(eq(faqEntry.event_id, body.from_event_id))
          .orderBy(asc(faqEntry.order), asc(faqEntry.id))
          .all()

        source.forEach((row, index) => {
          const id = randomUUID()

          tx.insert(faqEntry)
            .values({
              id,
              event_id: request.params.eventId,
              question: row.question,
              answer: row.answer,
              order: index,
              author_account_id: null,
              created_at,
            })
            .run()

          const card = threadIdFor(tx, {
            type: 'faq',
            id,
            event_id: request.params.eventId,
            title: row.question,
          })

          openWith(
            tx,
            {
              thread_id: card,
              kind: 'added',
              author_account_id: viewer.account_id,
              body: 'brought this over from a previous burn',
            },
            at,
          )
        })

        return 'seeded' as const
      })

      if (seeded === 'not_found') return sendError(reply, 404)
      if (seeded === 'conflict') return sendError(reply, 409)

      void reply.code(201)

      return withVersion(reply, await questions(request.params.eventId))
    },
  )
}
