import type { EventOption, EventOptionTaken, EventOptionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  errorResponse,
  eventOptionCreateSchema,
  eventOptionOrderSchema,
  eventOptionUpdateSchema,
  isEventOptionKind,
} from '@sage-burner/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { attendance, eventOption } from '../db/schema.ts'
import { noStore } from '../http.ts'

const optionsFor = async (db: Database, eventId: string): Promise<EventOptionTaken[]> => {
  const rows = await db
    .select()
    .from(eventOption)
    .where(eq(eventOption.event_id, eventId))
    .orderBy(asc(eventOption.kind), asc(eventOption.order), asc(eventOption.id))

  // One query for every count rather than one per option: at this size the whole
  // table is a handful of rows, and a loop of selects would be the slower, longer
  // way to say the same thing.
  const takers = await db
    .select({ option: attendance.lodging_option_id })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const counts = new Map<string, number>()
  for (const { option } of takers) {
    if (option !== null) counts.set(option, (counts.get(option) ?? 0) + 1)
  }

  return rows.map((row) => ({ ...row, taken: counts.get(row.id) ?? 0 }))
}

/**
 * The two lists a member picks from for a given burn.
 *
 * Rows rather than a shared vocabulary, per event rather than per community:
 * what there is to sleep in depends on the site, and what wants doing depends on
 * the year. Reads are public for the same reason the places are — nothing here
 * is about a person.
 */
export const registerEventOptionRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireAdmin } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>('/api/events/:eventId/options', async (request, reply) => {
    void reply.header('cache-control', 'no-cache')

    return { options: await optionsFor(db, request.params.eventId) } satisfies EventOptionsResponse
  })

  app.post<{ Params: { eventId: string } }>(
    '/api/admin/events/:eventId/options',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const parsed = eventOptionCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const { eventId } = request.params
      const id = randomUUID()

      // Read and insert together, so "the server assigns `order`" holds rather
      // than two adds claiming the same position. Per kind: the two lists number
      // independently.
      let order: number
      try {
        order = db.transaction((tx) => {
          const [last] = tx
            .select({ order: eventOption.order })
            .from(eventOption)
            .where(and(eq(eventOption.event_id, eventId), eq(eventOption.kind, parsed.data.kind)))
            .orderBy(desc(eventOption.order))
            .limit(1)
            .all()

          const next = last === undefined ? 0 : last.order + 1
          tx.insert(eventOption)
            .values({ ...parsed.data, id, event_id: eventId, order: next })
            .run()

          return next
        })
      } catch (failure) {
        // No pre-read of the event: the foreign key already rejects a missing
        // one, and asking first would be a second query saying the same thing.
        if (isForeignKeyViolation(failure)) return reply.code(404).send(errorResponse('not_found'))
        throw failure
      }

      return reply.code(201).send({
        option: { ...parsed.data, id, event_id: eventId, order } satisfies EventOption,
      })
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/admin/event-options/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const parsed = eventOptionUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      // `set({})` is not valid SQL.
      if (Object.keys(parsed.data).length === 0) {
        const [existing] = await db
          .select()
          .from(eventOption)
          .where(eq(eventOption.id, request.params.id))
          .limit(1)

        return existing === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : { option: existing }
      }

      const [updated] = await db
        .update(eventOption)
        .set(parsed.data)
        .where(eq(eventOption.id, request.params.id))
        .returning()

      return updated === undefined ? reply.code(404).send(errorResponse('not_found')) : { option: updated }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/event-options/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      // Somebody sleeping here holds the row: `attendance.lodging_option_id` has
      // no `onDelete`, so SQLite refuses rather than quietly unbooking them. A
      // pre-read would be check-then-act — someone can pick it between the read
      // and the delete — so the constraint is the authority and this translates.
      let deleted
      try {
        deleted = await db
          .delete(eventOption)
          .where(eq(eventOption.id, request.params.id))
          .returning({ id: eventOption.id })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(409).send(errorResponse('conflict'))
        throw failure
      }

      if (deleted.length === 0) return reply.code(404).send(errorResponse('not_found'))

      return reply.code(204).send()
    },
  )

  app.put<{ Params: { eventId: string; kind: string } }>(
    '/api/admin/events/:eventId/options/:kind/order',
    { preHandler: requireAdmin },
    async (request, reply) => {
      void noStore(reply)

      const { eventId, kind } = request.params
      if (!isEventOptionKind(kind)) return reply.code(404).send(errorResponse('not_found'))

      const parsed = eventOptionOrderSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const existing = (await optionsFor(db, eventId)).filter((row) => row.kind === kind)
      const wanted = parsed.data.ids

      // Exactly this kind's options, no more and no fewer. A partial list would
      // renumber some and leave the rest on stale positions.
      const sameSet = wanted.length === existing.length && existing.every((row) => wanted.includes(row.id))
      if (!sameSet) return reply.code(400).send(errorResponse('bad_request'))

      db.transaction((tx) => {
        wanted.forEach((id, index) => {
          tx.update(eventOption).set({ order: index }).where(eq(eventOption.id, id)).run()
        })
      })

      return { options: await optionsFor(db, eventId) } satisfies EventOptionsResponse
    },
  )
}
