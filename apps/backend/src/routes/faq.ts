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

/**
 * The Q&A the spreadsheet had a tab for (#28).
 *
 * **Any approved member may ask, answer, re-answer, reorder or remove**, which is
 * the default for the burn's shared furniture — the same reasoning the lead-roles
 * register spells out. The person with the question is rarely the person with the
 * answer, so an entry can exist with no answer at all and the page says where one is
 * still wanted.
 *
 * **Members, not the public.** The welcome text is this app's public surface; these
 * answers are the practical ones — how to find the gate, what the shower situation
 * is — and they are written for people who are already coming. It is the page most
 * worth reading *before* deciding to come, though, so the reader need not be coming
 * to this burn: `Faq.tsx` falls back to the open burn when the selector is empty
 * (#321), and the guard here is unchanged.
 *
 * Reads and writes are both `requireApproved`, and every write needs the burn to be
 * open: a finished burn's Q&A is the record of what was asked, and an id noted while
 * it was current should not still be a way to rewrite it. `openEventNow`, not the
 * active burn — the questions are answered months ahead, which is when they are
 * asked.
 */
export const registerFaqRoutes = (app: FastifyInstance, { db, sessions, now }: FaqDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  /** The list, as both the `GET` and every `If-Match` guard below see it (#274). */
  const questions = async (eventId: string): Promise<FaqListResponse> => ({
    entries: await faqFor(db, eventId),
  })

  /** The entry, when the burn it belongs to is open — the id alone does not say which. */
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

      // One transaction, for the reason `nextOrder` gives. Scoped to the burn: a new
      // burn's first question starts at zero rather than wherever the last one
      // stopped.
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

      // One read answering both "is it there" and "is its burn still open", so the
      // two cannot answer differently. `set({})` is not valid SQL, so the one body
      // that never reaches the UPDATE returns this row instead.
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

      // Deliberately does not renumber the survivors: `order` only has to sort, not
      // be contiguous, and renumbering here would fight a concurrent reorder for no
      // visible gain — the same call `places.ts` makes.
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

  /** The burns whose Q&A this one's could be seeded from, newest first. */
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

  /**
   * Seed this burn's Q&A from a previous burn's.
   *
   * Most of the answers carry over — what to bring, what the shower situation is —
   * and retyping fifteen of them four times a year is the friction worth removing,
   * exactly as it was for the roles. Refuses when this burn already has questions:
   * merging two lists is a decision nobody asked for, and "copy into empty" is the
   * case that removes the retyping.
   *
   * The emptiness check and the inserts are one transaction, or that refusal is not
   * true — two members clicking between separate awaits would both seed it. Not
   * something a test can hold: `inject` runs requests to completion in turn.
   */
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
        // **Open**, not merely existing — every other write here is scoped that way,
        // and seeding a burn that has ended would leave rows nothing can afterwards
        // edit, reorder or remove. Checked rather than left to the foreign key,
        // which only fires when there is a row to insert: copying from an empty
        // source into a burn that is not there would otherwise answer 200 with
        // nothing.
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

        // The order comes across as the order, not as the created stamp: this list is
        // read top to bottom, and the sequence somebody arranged is most of what the
        // copy is for.
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

      // 201 like `copyPlaces` and `copyLeadRoles` — rows were created — *and* tagged
      // like every other read of this list, which those two are not: the client holds
      // one tag per collection and a write that answers the new list may as well hand
      // it over rather than making the reload fetch it (#323).
      void reply.code(201)

      return withVersion(reply, await questions(request.params.eventId))
    },
  )
}
