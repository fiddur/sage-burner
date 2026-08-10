import type { CopySourcesResponse, FaqEntry, FaqListResponse, FaqResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  faqCopySchema,
  faqCreateSchema,
  faqUpdateSchema,
  idOrderSchema,
} from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { event, faqEntry } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { copySourcesFor } from './copy-sources.ts'
import { openEventNow, todayIso } from './events.ts'

export interface FaqDeps extends GuardDeps {
  now: () => Date
}

export const faqFor = (db: Database, eventId: string): Promise<FaqEntry[]> =>
  db
    .select()
    .from(faqEntry)
    .where(eq(faqEntry.event_id, eventId))
    .orderBy(asc(faqEntry.order), asc(faqEntry.id))

export const registerFaqRoutes = (app: FastifyInstance, { db, sessions, now }: FaqDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const questions = async (eventId: string): Promise<FaqListResponse> => ({
    entries: await faqFor(db, eventId),
  })

  const openEntry = async (id: string) => {
    const [row] = await db.select().from(faqEntry).where(eq(faqEntry.id, id)).limit(1)
    if (row === undefined) return undefined

    return (await openEventNow(db, now, row.event_id)) === undefined ? undefined : row
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

      const { eventId } = request.params
      if ((await openEventNow(db, now, eventId)) === undefined) return sendError(reply, 404)

      const id = randomUUID()
      const created_at = now().toISOString()

      const order = db.transaction((tx) => {
        const next = nextOrder(tx, faqEntry, eq(faqEntry.event_id, eventId))
        tx.insert(faqEntry)
          .values({ ...body, id, event_id: eventId, order: next, created_at })
          .run()

        return next
      })

      return reply
        .code(201)
        .send({ entry: { ...body, id, event_id: eventId, order, created_at } } satisfies FaqResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateFaqEntry.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(faqUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openEntry(request.params.id)
      if (existing === undefined) return sendError(reply, 404)
      if (Object.keys(body).length === 0) return { entry: existing } satisfies FaqResponse

      if (await refuseIfStale(request, reply, () => questions(existing.event_id))) return reply

      const [updated] = await db
        .update(faqEntry)
        .set(body)
        .where(eq(faqEntry.id, request.params.id))
        .returning()
      if (updated === undefined) return sendError(reply, 404)

      return await withCollectionVersion(reply, { entry: updated } satisfies FaqResponse, () =>
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

      await db.delete(faqEntry).where(eq(faqEntry.id, request.params.id))

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

      const created_at = now().toISOString()
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
          tx.insert(faqEntry)
            .values({
              id: randomUUID(),
              event_id: request.params.eventId,
              question: row.question,
              answer: row.answer,
              order: index,
              created_at,
            })
            .run()
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
